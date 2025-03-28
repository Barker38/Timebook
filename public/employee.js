/**
 * Класс для управления интерфейсом сотрудника
 */
class EmployeeScreen {
    constructor() {
        this.currentCard = null;
        this.currentEmployee = null;
        this.currentSessionStart = null;
        this.workDurationInterval = null;
        this.initElements();
        this.initWebSocket();
        this.initClock();
    }

    /**
     * Инициализация DOM элементов
     */
    initElements() {
        this.statusIcon = document.getElementById('status-icon');
        this.messageElement = document.getElementById('message');
        this.employeeName = document.getElementById('employee-name');
        this.errorMessage = document.getElementById('error-message');
        this.lastCheckinsList = document.getElementById('last-checkins-list');
        this.workDurationContainer = document.getElementById('work-duration-container');
        this.workDuration = document.getElementById('work-duration');
        this.currentTime = document.getElementById('current-time');
        this.connectionStatus = document.getElementById('connection-status');
        this.greetingMessage = document.getElementById('greeting-message');
    }

    /**
     * Инициализация WebSocket соединения
     */
    initWebSocket() {
        this.socket = new WebSocket('ws://localhost:3000/ws');

        this.socket.onopen = () => {
            console.log('WebSocket connected');
            this.updateConnectionStatus(true);
            this.showStatus('info', 'Готов к сканированию', 'fa-id-card');
        };

        this.socket.onmessage = async (e) => {
            try {
                const data = JSON.parse(e.data);
                console.log('[Employee] WebSocket message:', data);
                
                if (data.type === 'card_scanned') {
                    this.showStatus('info', 'Обработка карты...', 'fa-spinner fa-spin');
                    this.handleCardScan(data.data);
                } else if (data.type === 'card_valid') {
                    this.handleValidCard(data.data);
                } else if (data.type === 'card_invalid') {
                    this.handleInvalidCard(data.data);
                } else if (data.type === 'checkin_updated') {
                    this.handleCheckinUpdate(data.data);
                }
            } catch (error) {
                console.error('Error processing message:', error);
            }
        };

        this.socket.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.updateConnectionStatus(false);
        };

        this.socket.onclose = () => {
            console.log('WebSocket disconnected');
            this.updateConnectionStatus(false);
            setTimeout(() => this.initWebSocket(), 5000);
        };
    }

    /**
     * Инициализация часов
     */
    initClock() {
        this.updateClock();
        setInterval(() => this.updateClock(), 1000);
    }

    updateClock() {
        const now = new Date();
        this.currentTime.textContent = now.toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    /**
     * Обновление статуса соединения
     */
    updateConnectionStatus(connected) {
        if (connected) {
            this.connectionStatus.innerHTML = '<i class="fas fa-circle"></i> <span>Online</span>';
            this.connectionStatus.style.color = '#4CAF50';
        } else {
            this.connectionStatus.innerHTML = '<i class="fas fa-circle"></i> <span>Offline</span>';
            this.connectionStatus.style.color = '#f44336';
        }
    }

    /**
     * Обработка сканирования карты
     */
    handleCardScan(data) {
        this.currentCard = data.cardNumber.toUpperCase();
        this.showStatus('info', 'Обработка карты...', 'fa-spinner fa-spin');
        this.errorMessage.style.display = 'none';
    }

    /**
     * Обработка валидной карты
     */
    async handleValidCard(data) {
        try {
            this.currentEmployee = data.employee;
            
            // Обновляем статус сразу после получения данных
            this.employeeName.textContent = `${this.currentEmployee.name}${this.currentEmployee.position ? ` (${this.currentEmployee.position})` : ''}`;
            
            const statusResponse = await fetch(`/api/employees/${this.currentEmployee.id}/status`);
            if (statusResponse.ok) {
                const status = await statusResponse.json();
                
                if (status.is_active) {
                    this.showGreeting(`До свидания, ${this.currentEmployee.name.split(' ')[0]}!`, 'info');
                    this.showStatus('info', 'Уход регистрируется...', 'fa-spinner fa-spin');
                } else {
                    this.showGreeting(`Здравствуйте, ${this.currentEmployee.name.split(' ')[0]}!`, 'success');
                    this.showStatus('success', 'Приход регистрируется...', 'fa-spinner fa-spin');
                }
                
                await this.fetchLastCheckins(this.currentEmployee.id);
                
                if (status.is_active) {
                    this.workDurationContainer.style.display = 'block';
                    this.updateWorkDuration(status.current_session_minutes);
                } else {
                    this.workDurationContainer.style.display = 'none';
                }
            }
        } catch (error) {
            console.error('Error handling valid card:', error);
            this.showStatus('error', 'Ошибка обработки карты', 'fa-exclamation-circle');
        }
    }

    /**
     * Показывает приветственное сообщение
     */
    showGreeting(message, type) {
        this.greetingMessage.textContent = message;
        this.greetingMessage.style.display = 'block';
        this.greetingMessage.style.color = type === 'success' ? '#4CAF50' : 
                                          type === 'error' ? '#f44336' : '#2196F3';
        
        setTimeout(() => {
            this.greetingMessage.style.display = 'none';
        }, 3000);
    }

    /**
     * Обработка невалидной карты
     */
    handleInvalidCard(data) {
        this.errorMessage.innerHTML = ''; // Очистка предыдущих сообщений
        const errorText = document.createElement('div');
        errorText.textContent = 'Карта не зарегистрирована в системе';
        
        const addCardBtn = document.createElement('button');
        addCardBtn.className = 'btn-primary';
        addCardBtn.innerHTML = '<i class="fas fa-plus"></i> Зарегистрировать карту';
        addCardBtn.onclick = () => {
            window.open(`/admin.html?card=${data.cardNumber}`, '_blank');
        };
        
        this.errorMessage.appendChild(errorText);
        this.errorMessage.appendChild(addCardBtn);
        this.errorMessage.style.display = 'block';
    }

    /**
     * Обработка обновления отметки
     */
    handleCheckinUpdate(data) {
        console.log('Checkin update received:', data);
        
        if (!this.currentEmployee || data.employee_id !== this.currentEmployee.id) {
            return;
        }
    
        if (data.event_type === 'checkin') {
            this.showStatus('success', 'Приход зарегистрирован', 'fa-check-circle');
            this.workDurationContainer.style.display = 'block';
            this.currentSessionStart = new Date();
            this.updateWorkDuration(0);
        } else {
            const endTime = new Date();
            const duration = Math.floor((endTime - this.currentSessionStart) / 1000 / 60);
            const hours = Math.floor(duration / 60);
            const minutes = duration % 60;
            
            this.showStatus('info', 'Уход зарегистрирован', 'fa-info-circle');
            this.showGreeting(`Вы отработали ${hours} ч ${minutes} мин`, 'info');
            this.workDurationContainer.style.display = 'none';
            this.currentSessionStart = null;
        }
        
        // Принудительное обновление истории
        this.fetchLastCheckins(this.currentEmployee.id);
    }

    /**
     * Загрузка последних отметок
     */
    async fetchLastCheckins(employeeId) {
        try {
            const response = await fetch(`/api/employees/${employeeId}/checkins?limit=5`);
            if (!response.ok) throw new Error('Ошибка загрузки истории');
            
            const checkins = await response.json();
            this.renderLastCheckins(checkins);
        } catch (error) {
            console.error('Error fetching checkins:', error);
        }
    }

    /**
     * Отображение последних отметок
     */
    renderLastCheckins(checkins) {
        this.lastCheckinsList.innerHTML = '';
        
        checkins.forEach(checkin => {
            const li = document.createElement('li');
            
            const date = new Date(checkin.checkin_time).toLocaleDateString('ru-RU');
            const timeIn = new Date(checkin.checkin_time).toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit'});
            const timeOut = checkin.checkout_time 
                ? new Date(checkin.checkout_time).toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit'})
                : '-';
            
            let durationInfo = '';
            if (checkin.duration_minutes) {
                const hours = Math.floor(checkin.duration_minutes / 60);
                const minutes = checkin.duration_minutes % 60;
                durationInfo = `<div class="duration">${hours} ч ${minutes} мин</div>`;
            }
            
            li.innerHTML = `
                <span>${date}</span>
                <div>
                    <span class="time-badge checkin">${timeIn}</span>
                    <span class="time-badge checkout">${timeOut}</span>
                    ${durationInfo}
                </div>
            `;
            
            this.lastCheckinsList.appendChild(li);
        });
    }

    /**
     * Обновление отображения длительности работы
     */
    updateWorkDuration(minutes) {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        this.workDuration.textContent = `${hours} ч ${mins} мин`;
        
        if (this.workDurationInterval) {
            clearInterval(this.workDurationInterval);
        }
        
        this.workDurationInterval = setInterval(() => {
            minutes++;
            const h = Math.floor(minutes / 60);
            const m = minutes % 60;
            this.workDuration.textContent = `${h} ч ${m} мин`;
        }, 60000);
    }

    /**
     * Отображение статуса
     */
    showStatus(type, message, icon) {
        this.statusIcon.style.animation = '';
        this.statusIcon.className = '';
        
        const iconElement = document.createElement('i');
        iconElement.className = `fas ${icon}`;
        
        switch(type) {
            case 'success':
                iconElement.style.color = '#4CAF50';
                break;
            case 'error':
                iconElement.style.color = '#f44336';
                break;
            case 'info':
                iconElement.style.color = '#2196F3';
                break;
            default:
                iconElement.style.color = '#FF9800';
        }
        
        this.statusIcon.innerHTML = '';
        this.statusIcon.appendChild(iconElement);
        this.messageElement.textContent = message;
        this.statusIcon.style.animation = 'pulse 0.5s';
    }
}

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    new EmployeeScreen();
});