/**
 * Класс для управления админ-панелью
 */
class AdminPanel {
    constructor() {
        this.currentCard = null;
        this.activeCheckins = new Map();
        this.initWebSocket();
        this.initEventListeners();
        this.initModal();
        this.initReportFunctionality();
        this.loadEmployees();
        this.loadDashboard();
        this.startDashboardUpdater();
        this.lastUpdate = Date.now();
setInterval(() => {
    if (Date.now() - this.lastUpdate > 5000) { // Обновлять каждые 5 секунд
        this.loadDashboard();
        this.forceRenderEmployees();
        this.lastUpdate = Date.now();
    }
}, 1000);
        
        // Проверяем параметры URL для предзаполнения карты
        this.checkUrlParams();
    }

    /**
     * Проверяет параметры URL для предзаполнения карты
     */
    checkUrlParams() {
        const urlParams = new URLSearchParams(window.location.search);
        const cardNumber = urlParams.get('card');
        if (cardNumber) {
            this.currentCard = cardNumber;
            document.getElementById('add-employee-btn').click();
        }
    }

    /**
     * Инициализация WebSocket соединения
     */
    initWebSocket() {
        this.socket = new WebSocket('ws://localhost:3000/ws');
        
        this.socket.onopen = () => {
            console.log('WebSocket connected');
        };
    
        this.socket.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                console.log('WS message:', data);
                
                if (data.type === 'card_scanned') {
                    document.getElementById('card-number').value = data.data.cardNumber;
                    this.checkCardRegistration(data.data.cardNumber);
                }
            } catch (err) {
                console.error('WS message error:', err);
            }
        };
    
        this.socket.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    
        this.socket.onclose = () => {
            console.log('WebSocket disconnected, reconnecting...');
            setTimeout(() => this.initWebSocket(), 5000);
        };
    }

    /**
     * Обработка сканирования карты
     * @param {object} data - данные карты
     */handleCardScan(data) {
    const cardInput = document.getElementById('card-number');
    if (cardInput) {
        cardInput.value = data.cardNumber;
        // Добавляем триггер изменения
        const event = new Event('input', { bubbles: true });
        cardInput.dispatchEvent(event);
    }
    this.checkCardRegistration(data.cardNumber);
}

handleValidCard(data) {
    const cardStatus = document.getElementById('card-status');
    if (cardStatus) {
        cardStatus.textContent = `Карта зарегистрирована на: ${data.employee.name}`;
        cardStatus.className = 'card-status error';
        
        const cardInput = document.getElementById('card-number');
        if (cardInput) {
            cardInput.disabled = true;
            cardInput.style.backgroundColor = '#f8f9fa';
        }
    }
}
    /**
     * Обработка невалидной карты
     * @param {object} data - данные карты
     */
    handleInvalidCard(data) {
        const cardStatus = document.getElementById('card-status');
        if (cardStatus) {
            cardStatus.textContent = 'Карта свободна для регистрации';
            cardStatus.className = 'card-status success';
            
            // Разблокируем поле карты
            const cardInput = document.getElementById('card-number');
            cardInput.disabled = false;
            cardInput.style.backgroundColor = 'white';
        }
    }

    /**
     * Проверка регистрации карты
     * @param {string} cardNumber - номер карты
     */
    async checkCardRegistration(cardNumber) {
        try {
            console.log('Checking card:', cardNumber); // Логируем запрос
            const response = await fetch(`/api/employees/card/${cardNumber}`);
            console.log('Response status:', response.status); // Статус ответа
            
            const cardStatus = document.getElementById('card-status');
            if (!cardStatus) {
                console.error('Card status element not found!');
                return;
            }
            
            if (response.ok) {
                const employee = await response.json();
                cardStatus.textContent = `Карта зарегистрирована на: ${employee.name}`;
                cardStatus.className = 'card-status error';
            } else {
                cardStatus.textContent = 'Карта свободна для регистрации';
                cardStatus.className = 'card-status success';
            }
        } catch (error) {
            console.error('Ошибка проверки карты:', error);
        }
    }

    /**
     * Инициализация обработчиков событий
     */
    initEventListeners() {
        document.getElementById('add-employee-btn').addEventListener('click', () => {
            this.resetModal();
            document.getElementById('modal-title').innerHTML = '<i class="fas fa-user-plus"></i> Добавить сотрудника';
            document.getElementById('modal').style.display = 'block';
            
            // Автоматическая проверка карты при открытии модального окна
            if (this.currentCard) {
                this.checkCardRegistration(this.currentCard);
                document.getElementById('employee-name').focus();
            }
        });

        document.getElementById('search-input').addEventListener('input', (e) => {
            this.loadEmployees(e.target.value);
        });

        document.querySelector('.close').addEventListener('click', () => {
            document.getElementById('modal').style.display = 'none';
        });

        document.addEventListener('click', (e) => {
            if (e.target.closest('.btn-edit')) {
                const id = e.target.closest('button').dataset.id;
                this.editEmployee(id);
            }
            if (e.target.closest('.btn-delete')) {
                const id = e.target.closest('button').dataset.id;
                this.deleteEmployee(id);
            }
        });

        document.getElementById('employee-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveEmployee();
        });

        window.addEventListener('click', (e) => {
            if (e.target === document.getElementById('modal')) {
                document.getElementById('modal').style.display = 'none';
            }
        });
    }

    /**
     * Инициализация модального окна
     */
    initModal() {
        this.modal = document.getElementById('modal');
        this.modalForm = document.getElementById('employee-form');
        
        // Валидация ввода
        document.getElementById('card-number').addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
        });
        
        document.getElementById('employee-name').addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/[^a-zA-Zа-яА-Я\s]/g, '');
        });
    }

    /**
     * Инициализация функционала отчетов
     */
    initReportFunctionality() {
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        
        document.getElementById('report-start').valueAsDate = firstDay;
        document.getElementById('report-end').valueAsDate = today;

        this.loadEmployeesForReport();

        document.getElementById('generate-report').addEventListener('click', () => {
            this.generateReport();
        });

        document.getElementById('export-excel').addEventListener('click', () => {
            this.exportToExcel();
        });
    }

    /**
     * Загрузка списка сотрудников
     * @param {string} searchQuery - поисковый запрос
     */
    async loadEmployees(searchQuery = '') {
        try {
            const url = searchQuery 
                ? `/api/employees?search=${encodeURIComponent(searchQuery)}`
                : '/api/employees';
            
            const response = await fetch(url);
            if (!response.ok) throw new Error(await response.text());
            
            const employees = await response.json();
            this.renderEmployees(employees);
        } catch (error) {
            this.showAlert(`Ошибка загрузки: ${error.message}`, 'error');
        }
    }

    /**
     * Загрузка данных для дашборда
     */
    async loadDashboard() {
        try {
            const response = await fetch('/api/stats');
            const stats = await response.json();
            
            document.getElementById('total-employees').textContent = stats.total_employees;
            document.getElementById('active-employees').textContent = stats.active_now;
            
            // Принудительное обновление списка сотрудников
            this.loadEmployees(); 
        } catch (error) {
            console.error('Dashboard error:', error);
        }
    }

    /**
     * Загрузка сотрудников для выбора в отчетах
     */
    async loadEmployeesForReport() {
        try {
            const response = await fetch('/api/employees');
            if (!response.ok) throw new Error(await response.text());
            
            const employees = await response.json();
            const select = document.getElementById('report-employee');
            select.innerHTML = '<option value="">Все сотрудники</option>';
            
            employees.forEach(employee => {
                const option = document.createElement('option');
                option.value = employee.id;
                option.textContent = `${employee.name} (${employee.card_number})`;
                select.appendChild(option);
            });
        } catch (error) {
            this.showAlert(`Ошибка загрузки сотрудников: ${error.message}`, 'error');
        }
    }

    /**
     * Отображение списка сотрудников
     * @param {array} employees - массив сотрудников
     */
    renderEmployees(employees) {
        const tbody = document.querySelector('#employees-table tbody');
        if (!tbody) return;

        tbody.innerHTML = employees.map(employee => {
            const isActive = this.activeCheckins.has(employee.id) && 
                             this.activeCheckins.get(employee.id).type === 'checkin';
            
            return `
                <tr data-id="${employee.id}">
                    <td>${employee.card_number}</td>
                    <td>${employee.name}</td>
                    <td>${employee.position || '-'}</td>
                    <td>
                        <span class="status ${isActive ? 'status-present' : 'status-absent'}">
                            ${isActive ? 'На работе' : 'Не на работе'}
                        </span>
                    </td>
                    <td class="time">
                        ${isActive ? this.formatTime(this.activeCheckins.get(employee.id).time) : '-'}
                    </td>
                    <td>
                        <button class="btn-action btn-edit" data-id="${employee.id}">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-action btn-delete" data-id="${employee.id}">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    /**
     * Генерация отчета
     */
    async generateReport() {
        const employeeId = document.getElementById('report-employee').value;
        const startDate = document.getElementById('report-start').value;
        const endDate = document.getElementById('report-end').value;
    
        try {
            let params = new URLSearchParams();
            if (startDate) params.append('start', startDate);
            if (endDate) params.append('end', endDate);
            if (employeeId) params.append('employee', employeeId);
            
            const response = await fetch(`/api/report?${params.toString()}`);
            if (!response.ok) throw new Error(await response.text());
            
            const reportData = await response.json();
            this.renderReport(reportData);
        } catch (error) {
            this.showAlert(`Ошибка формирования отчета: ${error.message}`, 'error');
        }
    }

    /**
     * Отображение отчета
     * @param {array} data - данные отчета
     */
    renderReport(data) {
        const tbody = document.querySelector('#report-table tbody');
        tbody.innerHTML = '';
        
        let totalMinutes = 0;

        data.forEach(record => {
            const row = document.createElement('tr');
            
            const checkinTime = new Date(record.checkin_time);
            const checkoutTime = record.checkout_time ? new Date(record.checkout_time) : null;
            
            let duration = 'Не завершено';
            let durationMinutes = 0;
            
            if (checkoutTime) {
                durationMinutes = Math.round((checkoutTime - checkinTime) / (1000 * 60));
                const hours = Math.floor(durationMinutes / 60);
                const minutes = durationMinutes % 60;
                duration = `${hours} ч ${minutes} мин`;
                totalMinutes += durationMinutes;
            }
            
            row.innerHTML = `
                <td>${checkinTime.toLocaleDateString('ru-RU')}</td>
                <td>${record.employee_name}</td>
                <td>${checkinTime.toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit'})}</td>
                <td>${checkoutTime ? checkoutTime.toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit'}) : '-'}</td>
                <td>${duration}</td>
                <td>${record.notes || '-'}</td>
            `;
            
            tbody.appendChild(row);
        });

        const totalHours = Math.floor(totalMinutes / 60);
        const remainingMinutes = totalMinutes % 60;
        document.getElementById('total-hours').textContent = 
            `${totalHours} ч ${remainingMinutes} мин`;
    }

    /**
     * Экспорт в Excel
     */
    async exportToExcel() {
        const employeeId = document.getElementById('report-employee').value;
        const startDate = document.getElementById('report-start').value;
        const endDate = document.getElementById('report-end').value;

        try {
            let url = `/api/export?format=csv&start=${startDate}&end=${endDate}`;
            if (employeeId) url += `&employee=${employeeId}`;
            
            window.location.href = url;
        } catch (error) {
            this.showAlert(`Ошибка экспорта: ${error.message}`, 'error');
        }
    }

    /**
     * Редактирование сотрудника
     * @param {string} id - ID сотрудника
     */
    async editEmployee(id) {
        try {
            const response = await fetch(`/api/employees/${id}`);
            if (!response.ok) throw new Error(await response.text());
            
            const employee = await response.json();
            
            document.getElementById('employee-id').value = employee.id;
            document.getElementById('card-number').value = employee.card_number;
            document.getElementById('employee-name').value = employee.name;
            document.getElementById('employee-position').value = employee.position || '';
            
            document.getElementById('modal-title').innerHTML = '<i class="fas fa-user-edit"></i> Редактировать сотрудника';
            document.getElementById('modal').style.display = 'block';
        } catch (error) {
            this.showAlert(`Ошибка редактирования: ${error.message}`, 'error');
        }
    }

    /**
     * Сохранение сотрудника
     */
    async saveEmployee() {
        const id = document.getElementById('employee-id').value;
        const cardNumber = document.getElementById('card-number').value.trim();
        const name = document.getElementById('employee-name').value.trim();
        const position = document.getElementById('employee-position').value.trim();

        if (!cardNumber || !name) {
            this.showAlert('Заполните обязательные поля (номер карты и ФИО)', 'error');
            return;
        }

        try {
            const url = id ? `/api/employees/${id}` : '/api/employees';
            const method = id ? 'PUT' : 'POST';
            
            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    card_number: cardNumber, 
                    name, 
                    position: position || null 
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Ошибка сохранения');
            }
            
            document.getElementById('modal').style.display = 'none';
            this.loadEmployees();
            this.loadDashboard();
            this.showAlert('Сотрудник сохранен', 'success');
        } catch (error) {
            this.showAlert(`Ошибка сохранения: ${error.message}`, 'error');
        }
    }

    /**
     * Удаление сотрудника
     * @param {string} id - ID сотрудника
     */
    async deleteEmployee(id) {
        if (!confirm('Вы уверены, что хотите удалить сотрудника?')) return;
        
        try {
            const response = await fetch(`/api/employees/${id}`, { 
                method: 'DELETE' 
            });
            
            if (!response.ok) throw new Error(await response.text());
            
            this.loadEmployees();
            this.loadDashboard();
            this.showAlert('Сотрудник удален', 'success');
        } catch (error) {
            this.showAlert(`Ошибка удаления: ${error.message}`, 'error');
        }
    }

    /**
     * Обработка обновления сотрудника
     * @param {object} employee - данные сотрудника
     */
    handleEmployeeUpdate(employee) {
        this.loadEmployees();
        this.loadDashboard();
        this.showAlert(`Сотрудник ${employee.name} обновлен`, 'success');
    }

    /**
     * Обработка удаления сотрудника
     * @param {string} id - ID сотрудника
     */
    handleEmployeeDelete(id) {
        this.loadEmployees();
        this.loadDashboard();
        this.showAlert('Сотрудник удален', 'success');
    }

    /**
     * Обработка обновления отметки
     * @param {object} data - данные отметки
     */
    handleCheckinUpdate(data) {
        this.activeCheckins.set(data.employee_id, {
            type: data.event_type,
            time: new Date()
        });
        
        // Принудительное обновление UI
        this.loadEmployees(); 
        this.loadDashboard();
        
        // Обновление конкретной строки
        this.updateEmployeeStatus(data.employee_id, data.event_type);
    }
    
    // Добавьте этот метод для принудительного рендеринга:
    forceRenderEmployees() {
        const searchValue = document.getElementById('search-input').value;
        this.loadEmployees(searchValue);
    }

    /**
     * Обновление статуса сотрудника
     * @param {string} employeeId - ID сотрудника
     * @param {string} eventType - тип события (checkin/checkout)
     */
    updateEmployeeStatus(employeeId, eventType) {
        const row = document.querySelector(`tr[data-id="${employeeId}"]`);
        if (!row) return;
    
        const statusCell = row.querySelector('.status');
        const timeCell = row.querySelector('.time');
        
        if (eventType === 'checkin') {
            statusCell.textContent = 'На работе';
            statusCell.className = 'status status-present';
            timeCell.textContent = new Date().toLocaleTimeString('ru-RU', {
                hour: '2-digit', 
                minute: '2-digit'
            });
        } else if (eventType === 'checkout') {
            statusCell.textContent = 'Не на работе';
            statusCell.className = 'status status-absent';
            timeCell.textContent = '-';
        }
    }

    /**
     * Запуск обновления времени в дашборде
     */
    startDashboardUpdater() {
        setInterval(() => {
            this.updateActiveTimes();
        }, 60000); // Обновляем каждую минуту
    }

    /**
     * Обновление времени активных сессий
     */
    updateActiveTimes() {
        const now = new Date();
        this.activeCheckins.forEach((value, key) => {
            if (value.type === 'checkin') {
                const row = document.querySelector(`tr[data-id="${key}"]`);
                if (row) {
                    const timeCell = row.querySelector('.time');
                    timeCell.textContent = this.formatTime(value.time);
                }
            }
        });
    }

    /**
     * Сброс модального окна
     */
    resetModal() {
        document.getElementById('employee-id').value = '';
        document.getElementById('employee-form').reset();
        document.getElementById('card-status').textContent = '';
        document.getElementById('card-status').className = 'card-status';
        
        // Убираем подсветку поля карты
        const cardInput = document.getElementById('card-number');
        cardInput.parentElement.classList.remove('card-scanned');
        
        // Используем this.currentCard вместо data
        if (this.currentCard) {
            cardInput.value = this.currentCard;
            this.checkCardRegistration(this.currentCard); // Добавляем проверку карты
        }
    }
    /**
     * Форматирование времени
     * @param {Date} date - дата
     * @returns {string} отформатированное время
     */
    formatTime(date) {
        if (!date) return '-';
        return date.toLocaleTimeString('ru-RU', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    }

    /**
     * Показ уведомления
     * @param {string} message - текст сообщения
     * @param {string} type - тип сообщения (success/error)
     */
    showAlert(message, type) {
        const alert = document.createElement('div');
        alert.className = `alert alert-${type}`;
        alert.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
            ${message}
        `;
        
        document.body.appendChild(alert);
        
        setTimeout(() => alert.remove(), 5000);
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    new AdminPanel();
});