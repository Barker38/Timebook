require('dotenv').config();
const API_TOKEN = process.env.API_TOKEN || 'Taiga38';
const express = require('express');
const { Pool } = require('pg');
const WebSocket = require('ws');
const path = require('path');
const { Parser } = require('json2csv');
const cors = require('cors');
const morgan = require('morgan');
const clients = new Set();

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
});

const app = express();
const publicPath = path.join(__dirname);
app.use(express.static(publicPath));
app.use(cors({
    origin: 'http://localhost:3000', // Ваш домен
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(morgan('combined'));

const wss = new WebSocket.Server({ noServer: true });


// Database Health Check
pool.query('SELECT 1')
    .then(() => console.log('Connected to PostgreSQL'))
    .catch(err => console.error('PostgreSQL connection error:', err));

// WebSocket Connection Handler
wss.on('connection', (ws) => {
    console.log('New WebSocket connection');
    clients.add(ws);

    ws.on('message', (message) => {
        console.log('Received:', message.toString());
    });

    ws.on('close', () => {
        console.log('WebSocket disconnected');
        clients.delete(ws);
    });
});
// Helper function to notify all clients
function notifyClients(type, data) {
    const message = JSON.stringify({ type, data });
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
            console.log('Sent to all clients:', message);
        }
    });
}

// Employees API
app.get('/api/employees', async (req, res) => {
    try {
        const search = req.query.search || '';
        const result = await pool.query(`
            SELECT 
                e.*,
                (SELECT COUNT(*) FROM checkins WHERE employee_id = e.id)::integer as checkins_count
            FROM employees e
            WHERE $1 = '' OR e.name ILIKE $1 OR e.card_number ILIKE $1
            ORDER BY e.name
        `, [`%${search}%`]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/employees/card/:cardNumber', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM employees WHERE card_number = $1',
            [req.params.cardNumber]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                error: 'Карта не зарегистрирована',
                cardNumber: req.params.cardNumber
            });
        }
        
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/employees/:id', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM employees WHERE id = $1',
            [req.params.id]
        );
        res.json(result.rows[0] || {});
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/employees/:id/status', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                EXISTS(
                    SELECT 1 FROM checkins 
                    WHERE employee_id = $1 AND checkout_time IS NULL
                ) as is_active,
                COALESCE(
                    EXTRACT(EPOCH FROM (NOW() - checkin_time))/60, 
                    0
                )::integer as current_session_minutes
            FROM checkins
            WHERE employee_id = $1 AND checkout_time IS NULL
            LIMIT 1
        `, [req.params.id]);
        res.json(result.rows[0] || { is_active: false, current_session_minutes: 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/employees/:id/checkins', async (req, res) => {
    try {
        const limit = req.query.limit || 5;
        const result = await pool.query(`
            SELECT 
                id,
                employee_id,
                checkin_time,
                checkout_time,
                CASE 
                    WHEN checkout_time IS NULL THEN NULL
                    ELSE EXTRACT(EPOCH FROM (checkout_time - checkin_time))/60
                END::integer as duration_minutes
            FROM checkins
            WHERE employee_id = $1
            ORDER BY checkin_time DESC
            LIMIT $2
        `, [req.params.id, limit]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/employees', async (req, res) => {
    try {
        let { card_number, name, position } = req.body;
        // Приводим номер карты к верхнему регистру
        card_number = card_number.toUpperCase();
        
        const exists = await pool.query(
            'SELECT id FROM employees WHERE card_number = $1', 
            [card_number]
        );
        if (exists.rows.length > 0) {
            return res.status(400).json({ error: 'Карта уже зарегистрирована' });
        }
        const result = await pool.query(
            `INSERT INTO employees (card_number, name, position) 
             VALUES ($1, $2, $3) RETURNING *`,
            [card_number, name, position || null]
        );
        notifyClients('employee_updated', result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/employees/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, position } = req.body;
        const result = await pool.query(
            `UPDATE employees 
             SET name = $1, position = $2 
             WHERE id = $3 RETURNING *`,
            [name, position || null, id]
        );
        notifyClients('employee_updated', result.rows[0]);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/employees/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM checkins WHERE employee_id = $1', [id]);
        const result = await pool.query(
            'DELETE FROM employees WHERE id = $1 RETURNING *', 
            [id]
        );
        notifyClients('employee_deleted', { id });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Checkins API
app.post('/api/checkins', async (req, res) => {
    try {
        const { card_number } = req.body;
        console.log(`Processing checkin for card: ${card_number}`);
        
        // 1. Находим сотрудника
        const employee = await pool.query(
            'SELECT id FROM employees WHERE card_number = $1', 
            [card_number]
        );
        
        if (employee.rows.length === 0) {
            return res.status(404).json({ error: 'Карта не зарегистрирована' });
        }

        const employeeId = employee.rows[0].id;
        
        // 2. Проверяем открытую отметку
        const openCheckin = await pool.query(
            `SELECT id FROM checkins 
             WHERE employee_id = $1 AND checkout_time IS NULL
             LIMIT 1`,
            [employeeId]
        );
        
        if (openCheckin.rows.length === 0) {
            // Создать новую отметку
            result = await pool.query(
                `INSERT INTO checkins (employee_id) 
                 VALUES ($1) RETURNING *`,
                [employeeId]
            );
            eventType = 'checkin';
        } else {
            // Обновить существующую
            result = await pool.query(
                `UPDATE checkins SET 
                    checkout_time = NOW() 
                 WHERE id = $1 RETURNING *`,
                [openCheckin.rows[0].id]
            );
            eventType = 'checkout';
        }

        // 3. Отправляем уведомление
        notifyClients('checkin_updated', {
            employee_id: employeeId,
            card_number: card_number,
            event_type: eventType,
            timestamp: new Date().toISOString()
            
        });

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Checkin error:', err);
        res.status(500).json({ 
            error: 'Ошибка сервера',
            details: err.message 
        });
    }
});

// Reports API
app.get('/api/report', async (req, res) => {
    try {
        const { start, end, employee } = req.query;
        let query = `
            SELECT 
                e.name as employee_name,
                c.checkin_time,
                c.checkout_time,
                CASE 
                    WHEN c.checkout_time IS NULL THEN NULL
                    ELSE EXTRACT(EPOCH FROM (c.checkout_time - c.checkin_time))/60
                END::integer as duration_minutes
            FROM checkins c
            JOIN employees e ON e.id = c.employee_id
            WHERE ($1::date IS NULL OR c.checkin_time >= $1::date)
              AND ($2::date IS NULL OR c.checkout_time <= $2::date OR c.checkout_time IS NULL)
        `;
        
        const params = [start || null, end || null];
        if (employee) {
            query += ' AND e.id = $3';
            params.push(employee);
        }
        query += ' ORDER BY c.checkin_time DESC';
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Stats API
app.get('/api/stats', async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT 
                COUNT(DISTINCT e.id) as total_employees,
                COUNT(c.id) as total_checkins,
                COUNT(c.id) FILTER (WHERE c.checkin_time::date = CURRENT_DATE) as today_checkins,
                COUNT(c.id) FILTER (WHERE c.checkout_time IS NULL) as active_now
            FROM employees e
            LEFT JOIN checkins c ON e.id = c.employee_id
        `);
        res.json(stats.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Export API
app.get('/api/export', async (req, res) => {
    try {
        const { format, start, end, employee } = req.query;
        let query = `
            SELECT 
                e.name as "Сотрудник",
                e.card_number as "Номер карты",
                c.checkin_time as "Время прихода",
                c.checkout_time as "Время ухода",
                (c.checkout_time - c.checkin_time) as "Длительность",
                c.notes as "Примечание"
            FROM checkins c
            JOIN employees e ON e.id = c.employee_id
            WHERE ($1::date IS NULL OR c.checkin_time >= $1::date)
              AND ($2::date IS NULL OR c.checkin_time <= $2::date)
        `;
        const params = [start || null, end || null];
        if (employee) {
            query += ' AND e.id = $3';
            params.push(employee);
        }
        query += ' ORDER BY c.checkin_time DESC';
        const result = await pool.query(query, params);
        if (format === 'csv') {
            const fields = [
                { label: 'Дата', value: row => new Date(row['Время прихода']).toLocaleDateString('ru-RU') },
                { label: 'Сотрудник', value: 'Сотрудник' },
                { label: 'Приход', value: row => new Date(row['Время прихода']).toLocaleTimeString('ru-RU') },
                { label: 'Уход', value: row => row['Время ухода'] ? new Date(row['Время ухода']).toLocaleTimeString('ru-RU') : '-' },
                { 
                    label: 'Отработано', 
                    value: row => {
                        if (!row['Время ухода']) return '-';
                        const minutes = Math.round((new Date(row['Время ухода']) - new Date(row['Время прихода'])) / (1000 * 60));
                        return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
                    }
                },
                { label: 'Примечание', value: 'Примечание' }
            ];
            const parser = new Parser({ fields });
            const csv = parser.parse(result.rows);
            res.header('Content-Type', 'text/csv');
            res.attachment(`work_report_${new Date().toISOString().slice(0,10)}.csv`);
            return res.send(csv);
        }
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Запуск сервера
const server = app.listen(3000, () => {
    console.log('Сервер запущен на порту 3000');
});

server.on('upgrade', (request, socket, head) => {
    // Разрешаем все origin (для тестирования)
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET'
    };

    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});
// Auto-close stale checkins (every hour)
setInterval(async () => {
    try {
        const result = await pool.query(`
            UPDATE checkins
            SET 
                checkout_time = checkin_time + INTERVAL '14 hours',
                notes = 'Автоматически закрытая сессия'
            WHERE checkout_time IS NULL 
            AND checkin_time < NOW() - INTERVAL '14 hours'
            RETURNING id, employee_id
        `);
        if (result.rows.length > 0) {
            console.log(`Автоматически закрыто ${result.rows.length} сессий`);
            result.rows.forEach(row => {
                notifyClients('checkin_updated', {
                    employee_id: row.employee_id,
                    event_type: 'auto_checkout'
                });
            });
        }
    } catch (err) {
        console.error('Ошибка автоматического закрытия сессий:', err);
    }
}, 3600000); // Every hour