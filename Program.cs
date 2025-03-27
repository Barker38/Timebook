using System;
using System.IO.Ports;
using System.Net.WebSockets;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Serilog;
using System.Net.Http.Json; // Добавлено пространство имён

namespace Z2M_Mifare
{
    class Program
    {
        private static readonly HttpClient httpClient = new HttpClient();
        private static ClientWebSocket? ws; // Добавлен nullable модификатор
        private static bool isRunning = true;
        private static readonly object wsLock = new object();
        private static readonly TimeSpan ReconnectDelay = TimeSpan.FromSeconds(5);
        private static readonly TimeSpan KeepAliveInterval = TimeSpan.FromSeconds(30);
        private static CancellationTokenSource cts = new CancellationTokenSource();

        static async Task Main(string[] args)
        {
            InitializeLogger();
            AppDomain.CurrentDomain.ProcessExit += async (s, e) => await CleanupResources();

            Console.CancelKeyPress += async (sender, e) => 
            {
                e.Cancel = true;
                isRunning = false;
                await CleanupResources();
                Environment.Exit(0);
            };

            try
            {
                Log.Information("Starting RFID Server...");
                InitializeHttpClient();
                await InitializeWebSocket();
                await ProcessSerialPort();
            }
            catch (Exception ex)
            {
                Log.Fatal(ex, "Critical error occurred");
            }
            finally
            {
                await CleanupResources();
                Log.Information("Server stopped");
                Log.CloseAndFlush();
            }
        }

        static void InitializeLogger()
        {
            Log.Logger = new LoggerConfiguration()
                .MinimumLevel.Debug()
                .WriteTo.Console(outputTemplate: "{Timestamp:HH:mm:ss} [{Level}] {Message}{NewLine}{Exception}")
                .WriteTo.File("logs/rfid-log.txt", 
                    rollingInterval: RollingInterval.Day,
                    retainedFileCountLimit: 7)
                .CreateLogger();
        }

        static void InitializeHttpClient()
        {
            httpClient.BaseAddress = new Uri("http://localhost:3000/");
            httpClient.Timeout = TimeSpan.FromSeconds(15);
        }

        static async Task InitializeWebSocket()
        {
            while (isRunning)
            {
                try
                {
                    lock (wsLock)
                    {
                        if (ws?.State == WebSocketState.Open) return;
                        
                        ws?.Dispose();
                        ws = new ClientWebSocket();
                        ws.Options.KeepAliveInterval = KeepAliveInterval;
                    }

                    Log.Information("Connecting to WebSocket...");
                    await ws.ConnectAsync(new Uri("ws://localhost:3000/ws"), cts.Token);
                    Log.Information("WebSocket connected successfully");
                    return;
                }
                catch (Exception ex)
                {
                    Log.Error(ex, "WebSocket connection failed");
                    await Task.Delay(ReconnectDelay, cts.Token);
                }
            }
        }

        static async Task ProcessSerialPort()
        {
            using (var port = new SerialPort("COM3", 9600, Parity.None, 8, StopBits.One))
            {
                port.Open();
                Log.Information("RFID reader connected to COM3");

                while (isRunning)
                {
                    try
                    {
                        if (port.BytesToRead > 0)
                        {
                            var data = port.ReadLine().Trim();
                            Log.Debug($"Received data: {data}");
                            
                            if (TryParseCardData(data, out string cardNumber))
                            {
                                await ProcessCard(cardNumber);
                            }
                        }
                        await Task.Delay(100, cts.Token);
                    }
                    catch (Exception ex)
                    {
                        Log.Error(ex, "Error processing serial port data");
                        await Task.Delay(1000, cts.Token);
                    }
                }
            }
        }

        static bool TryParseCardData(string data, out string cardNumber)
        {
            cardNumber = null!; // Исправлено предупреждение CS8625
            
            if (data.StartsWith("Mifare["))
            {
                int start = data.IndexOf('[') + 1;
                int end = data.IndexOf(']');
                if (end > start)
                {
                    cardNumber = data.Substring(start, end - start);
                    Log.Information($"Card detected: {cardNumber}");
                    return true;
                }
            }
            return false;
        }

       static async Task ProcessCard(string cardNumber)
{
    try
    {
        Log.Information($"Processing card: {cardNumber}");
        
        // 1. Отправляем событие сканирования
        await SendWebSocketMessage(new 
        { 
            type = "card_scanned",
            data = new { cardNumber }
        });

        // 2. Проверяем карту
        var response = await httpClient.GetAsync($"/api/employees/card/{cardNumber}");
        
        if (response.IsSuccessStatusCode)
        {
            var employee = await response.Content.ReadAsStringAsync();
            
            // 3. Отправляем данные сотрудника
            await SendWebSocketMessage(new 
            { 
                type = "card_valid",
                data = new {
                    cardNumber,
                    employee = JsonConvert.DeserializeObject(employee)
                }
            });

            // 4. Создаем отметку
            var checkinResponse = await httpClient.PostAsJsonAsync(
                "/api/checkins", 
                new { card_number = cardNumber }
            );
            
            if (!checkinResponse.IsSuccessStatusCode)
            {
                var error = await checkinResponse.Content.ReadAsStringAsync();
                Log.Error($"Checkin failed: {error}");
            }
        }
        else
        {
            await SendWebSocketMessage(new 
            { 
                type = "card_invalid",
                data = new {
                    cardNumber,
                    error = "Карта не зарегистрирована"
                }
            });
        }
    }
    catch (Exception ex)
    {
        Log.Error(ex, $"Card processing error: {cardNumber}");
    }
}
        static async Task<bool> SendWebSocketMessage(object message)
        {
            if (ws?.State != WebSocketState.Open)
            {
                Log.Warning("WebSocket not connected, attempting reconnect...");
                try
                {
                    await InitializeWebSocket();
                    if (ws?.State != WebSocketState.Open) 
                    {
                        Log.Error("Failed to reconnect WebSocket");
                        return false;
                    }
                }
                catch (Exception ex)
                {
                    Log.Error(ex, "WebSocket reconnect failed");
                    return false;
                }
            }

            try
            {
                string json = JsonConvert.SerializeObject(message);
                byte[] buffer = Encoding.UTF8.GetBytes(json);
                
                await ws.SendAsync(
                    new ArraySegment<byte>(buffer),
                    WebSocketMessageType.Text,
                    true,
                    cts.Token);
                
                Log.Debug($"Message sent: {json}");
                return true;
            }
            catch (WebSocketException ex) when (ex.WebSocketErrorCode == WebSocketError.ConnectionClosedPrematurely)
            {
                Log.Warning("WebSocket connection closed, will reconnect");
                await InitializeWebSocket();
                return false;
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Error sending WebSocket message");
                return false;
            }
        }

        static async Task SendWithRetry(Func<Task<bool>> sendAction, int maxRetries = 3)
        {
            int retryCount = 0;
            while (retryCount < maxRetries)
            {
                if (await sendAction()) return;
                retryCount++;
                await Task.Delay(1000 * retryCount);
            }
        }

        static async Task CleanupResources()
        {
            try
            {
                cts.Cancel();
                Log.Information("Cleaning up resources...");
                
                if (ws != null)
                {
                    if (ws.State == WebSocketState.Open)
                    {
                        await ws.CloseAsync(
                            WebSocketCloseStatus.NormalClosure,
                            "Normal shutdown",
                            CancellationToken.None);
                    }
                    ws.Dispose();
                }
                
                httpClient?.Dispose();
                cts.Dispose();
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Error during resource cleanup");
            }
        }
    }
}