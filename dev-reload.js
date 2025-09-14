// Development-only auto-reload client
// This file is only included in development builds

(function () {
	// Only run in development (unpacked extensions have an update URL)
	if (!chrome.runtime.getManifest().update_url) {
		console.log(' Connecting to watch server...');

		let reconnectTimer = null;
		let reconnectAttempts = 0;
		const maxReconnectAttempts = 5;
		const reconnectDelay = 1000; // Start with 1 second

		function connect() {
			try {
				let ws;
				try {
					ws = new WebSocket('ws://localhost:9222');
				} catch (error) { return; }

				ws.onopen = () => {
					console.log(' Connected to watch server');
					reconnectAttempts = 0;
					clearTimeout(reconnectTimer);
				};

				ws.onmessage = (event) => {
					try {
						const message = JSON.parse(event.data);

						if (message.type === 'reload') {
							console.log(' Reloading extension...');

							// Close the WebSocket before reloading
							ws.close();

							// Small delay to ensure socket is closed
							setTimeout(() => {
								chrome.runtime.reload();
							}, 50);
						} else if (message.type === 'connected') {
							console.log(' Watch server confirmed connection');
						}
					} catch (error) {
						console.error(' Failed to parse message:', error);
					}
				};

				ws.onerror = (error) => {
					// console.error(' WebSocket error:', error);
				};

				ws.onclose = () => {
					// console.log(' Disconnected from watch server');

					// Try to reconnect with exponential backoff
					if (reconnectAttempts < maxReconnectAttempts) {
						const delay = reconnectDelay * Math.pow(2, reconnectAttempts);
						// console.log(` Reconnecting in ${delay}ms... (attempt ${reconnectAttempts + 1}/${maxReconnectAttempts})`);

						reconnectTimer = setTimeout(() => {
							reconnectAttempts++;
							connect();
						}, delay);
					} else {
						// console.log(' Max reconnection attempts reached. Run "npm run watch" to enable auto-reload.');
					}
				};

			} catch (error) {
				console.error(' Failed to create WebSocket:', error);
			}
		}

		// Initial connection
		connect();

		// Also listen for manual reconnect via console
		// Useful for debugging: chrome.runtime.sendMessage({type: 'DEV_RELOAD_RECONNECT'})
		chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
			if (request.type === 'DEV_RELOAD_RECONNECT') {
				console.log(' Manual reconnect requested');
				reconnectAttempts = 0;
				connect();
				sendResponse({ status: 'reconnecting' });
			}
		});

	} else {
		console.log(' Skipping - this is a production build');
	}
})();