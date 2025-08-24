/**
 * Universal Smartphone Game Controller - Client Side
 * Handles user interactions and WebSocket communication
 */

class GameController {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.mouseSensitivity = 2;
        this.pressedButtons = new Set();
        
        // Trackpad state
        this.trackpadActive = false;
        this.lastTouch = { x: 0, y: 0 };
        this.isTracking = false;
        this.clickTimeout = null;
        this.longPressTimeout = null;
        
        // UI elements
        this.elements = {
            loadingScreen: document.getElementById('loading-screen'),
            instructionsModal: document.getElementById('instructions-modal'),
            statusText: document.getElementById('status-text'),
            connectionStatus: document.getElementById('connection-status'),
            trackpad: document.getElementById('trackpad'),
            trackpadCursor: document.querySelector('.trackpad-cursor'),
            mouseSensitivity: document.getElementById('mouse-sensitivity'),
            sensitivityValue: document.getElementById('sensitivity-value'),
            hapticIndicator: document.getElementById('haptic-indicator'),
            vibrationTest: document.getElementById('vibration-test'),
            closeInstructions: document.getElementById('close-instructions'),
            startControlling: document.getElementById('start-controlling')
        };
        
        this.init();
    }
    
    init() {
        this.initializeSocket();
        this.setupEventListeners();
        this.setupTrackpad();
        this.preventContextMenu();
        this.enableFullscreen();
    }
    
    /**
     * Initialize WebSocket connection
     */
    initializeSocket() {
        console.log('🔌 Connecting to server...');
        this.updateStatus('Connecting...', false);
        
        // Connect to server (automatically detects host)
        this.socket = io();
        
        // Connection successful
        this.socket.on('connect', () => {
            console.log('✅ Connected to server');
            this.isConnected = true;
            this.updateStatus('Connected', true);
            this.hideLoadingScreen();
        });
        
        // Connection confirmed by server
        this.socket.on('connected', (data) => {
            console.log('🎮 Controller ready:', data.message);
            this.showInstructionsModal();
        });
        
        // Handle disconnection
        this.socket.on('disconnect', (reason) => {
            console.log('❌ Disconnected:', reason);
            this.isConnected = false;
            this.updateStatus('Disconnected', false);
            this.showLoadingScreen();
            this.releaseAllButtons();
        });
        
        // Handle vibration requests from server
        this.socket.on('vibrate', (data) => {
            this.triggerHapticFeedback(data.duration, data.intensity);
        });
        
        // Connection error
        this.socket.on('connect_error', (error) => {
            console.error('💥 Connection error:', error);
            this.updateStatus('Connection Error', false);
        });
        
        // Reconnection attempts
        this.socket.on('reconnect_attempt', (attemptNumber) => {
            console.log(`🔄 Reconnection attempt ${attemptNumber}`);
            this.updateStatus(`Reconnecting... (${attemptNumber})`, false);
        });
        
        this.socket.on('reconnect', (attemptNumber) => {
            console.log(`✅ Reconnected after ${attemptNumber} attempts`);
            this.isConnected = true;
            this.updateStatus('Connected', true);
            this.hideLoadingScreen();
        });
    }
    
    /**
     * Setup all event listeners for controls
     */
    setupEventListeners() {
        // D-pad and action buttons
        document.querySelectorAll('[data-button]').forEach(button => {
            const buttonName = button.getAttribute('data-button');
            
            // Mouse events (for desktop testing)
            button.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.handleButtonPress(buttonName, button);
            });
            
            button.addEventListener('mouseup', (e) => {
                e.preventDefault();
                this.handleButtonRelease(buttonName, button);
            });
            
            // Touch events (primary for mobile)
            button.addEventListener('touchstart', (e) => {
                e.preventDefault();
                this.handleButtonPress(buttonName, button);
            });
            
            button.addEventListener('touchend', (e) => {
                e.preventDefault();
                this.handleButtonRelease(buttonName, button);
            });
            
            // Prevent context menu and text selection
            button.addEventListener('contextmenu', (e) => e.preventDefault());
            button.addEventListener('selectstart', (e) => e.preventDefault());
        });
        
        // Mouse sensitivity control
        this.elements.mouseSensitivity.addEventListener('input', (e) => {
            this.mouseSensitivity = parseFloat(e.target.value);
            this.elements.sensitivityValue.textContent = `${this.mouseSensitivity}x`;
        });
        
        // Vibration test button
        this.elements.vibrationTest.addEventListener('click', () => {
            this.testVibration();
        });
        
        // Modal controls
        this.elements.closeInstructions.addEventListener('click', () => {
            this.hideInstructionsModal();
        });
        
        this.elements.startControlling.addEventListener('click', () => {
            this.hideInstructionsModal();
        });
        
        // Prevent window scrolling and zooming
        document.addEventListener('touchmove', (e) => {
            if (e.target !== this.elements.trackpad && !this.elements.trackpad.contains(e.target)) {
                e.preventDefault();
            }
        }, { passive: false });
        
        document.addEventListener('gesturestart', (e) => e.preventDefault());
        document.addEventListener('gesturechange', (e) => e.preventDefault());
    }
    
    /**
     * Setup trackpad for mouse control
     */
    setupTrackpad() {
        const trackpad = this.elements.trackpad;
        const cursor = this.elements.trackpadCursor;
        
        // Touch events for trackpad
        trackpad.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.startTrackpadTouch(e);
        });
        
        trackpad.addEventListener('touchmove', (e) => {
            e.preventDefault();
            this.handleTrackpadMove(e);
        });
        
        trackpad.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.endTrackpadTouch(e);
        });
        
        // Mouse events for desktop testing
        trackpad.addEventListener('mousedown', (e) => {
            e.preventDefault();
            this.startTrackpadMouse(e);
        });
        
        trackpad.addEventListener('mousemove', (e) => {
            e.preventDefault();
            this.handleTrackpadMouseMove(e);
        });
        
        trackpad.addEventListener('mouseup', (e) => {
            e.preventDefault();
            this.endTrackpadMouse(e);
        });
        
        trackpad.addEventListener('mouseleave', (e) => {
            this.endTrackpadMouse(e);
        });
    }
    
    /**
     * Handle trackpad touch start
     */
    startTrackpadTouch(e) {
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            const rect = this.elements.trackpad.getBoundingClientRect();
            
            this.lastTouch = {
                x: touch.clientX - rect.left,
                y: touch.clientY - rect.top
            };
            
            this.isTracking = true;
            this.trackpadActive = true;
            this.elements.trackpad.classList.add('active');
            
            this.updateTrackpadCursor(this.lastTouch.x, this.lastTouch.y);
            
            // Setup click detection
            this.clickTimeout = setTimeout(() => {
                // Long press - right click
                this.sendMouseClick('right');
                this.showHapticFeedback();
            }, 500);
        }
    }
    
    /**
     * Handle trackpad touch movement
     */
    handleTrackpadMove(e) {
        if (!this.isTracking || e.touches.length !== 1) return;
        
        const touch = e.touches[0];
        const rect = this.elements.trackpad.getBoundingClientRect();
        const currentTouch = {
            x: touch.clientX - rect.left,
            y: touch.clientY - rect.top
        };
        
        // Calculate movement delta
        const deltaX = currentTouch.x - this.lastTouch.x;
        const deltaY = currentTouch.y - this.lastTouch.y;
        
        // Send mouse movement
        if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
            this.sendMouseMove(deltaX, deltaY);
            this.lastTouch = currentTouch;
            
            // Clear click timeout on movement
            if (this.clickTimeout) {
                clearTimeout(this.clickTimeout);
                this.clickTimeout = null;
            }
        }
        
        this.updateTrackpadCursor(currentTouch.x, currentTouch.y);
    }
    
    /**
     * Handle trackpad touch end
     */
    endTrackpadTouch(e) {
        this.isTracking = false;
        this.trackpadActive = false;
        this.elements.trackpad.classList.remove('active');
        
        // Handle tap (left click)
        if (this.clickTimeout) {
            clearTimeout(this.clickTimeout);
            this.clickTimeout = null;
            this.sendMouseClick('left');
            this.showHapticFeedback();
        }
    }
    
    /**
     * Handle mouse events for desktop testing
     */
    startTrackpadMouse(e) {
        const rect = this.elements.trackpad.getBoundingClientRect();
        this.lastTouch = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
        this.isTracking = true;
        this.trackpadActive = true;
        this.elements.trackpad.classList.add('active');
        this.updateTrackpadCursor(this.lastTouch.x, this.lastTouch.y);
    }
    
    handleTrackpadMouseMove(e) {
        if (!this.isTracking) return;
        
        const rect = this.elements.trackpad.getBoundingClientRect();
        const currentPos = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
        
        const deltaX = currentPos.x - this.lastTouch.x;
        const deltaY = currentPos.y - this.lastTouch.y;
        
        this.sendMouseMove(deltaX, deltaY);
        this.lastTouch = currentPos;
        this.updateTrackpadCursor(currentPos.x, currentPos.y);
    }
    
    endTrackpadMouse(e) {
        if (this.isTracking) {
            this.sendMouseClick(e.button === 2 ? 'right' : 'left');
        }
        this.isTracking = false;
        this.trackpadActive = false;
        this.elements.trackpad.classList.remove('active');
    }
    
    /**
     * Update trackpad cursor position
     */
    updateTrackpadCursor(x, y) {
        this.elements.trackpadCursor.style.left = `${x}px`;
        this.elements.trackpadCursor.style.top = `${y}px`;
    }
    
    /**
     * Handle button press
     */
    handleButtonPress(buttonName, buttonElement) {
        if (this.pressedButtons.has(buttonName) || !this.isConnected) return;
        
        this.pressedButtons.add(buttonName);
        buttonElement.classList.add('pressed');
        
        // Send button press to server
        this.socket.emit('button-press', { button: buttonName });
        
        // Haptic feedback for button press
        this.showHapticFeedback();
        
        console.log(`🎮 Button pressed: ${buttonName}`);
    }
    
    /**
     * Handle button release
     */
    handleButtonRelease(buttonName, buttonElement) {
        if (!this.pressedButtons.has(buttonName) || !this.isConnected) return;
        
        this.pressedButtons.delete(buttonName);
        buttonElement.classList.remove('pressed');
        
        // Send button release to server
        this.socket.emit('button-release', { button: buttonName });
        
        console.log(`🎮 Button released: ${buttonName}`);
    }
    
    /**
     * Send mouse movement to server
     */
    sendMouseMove(deltaX, deltaY) {
        if (!this.isConnected) return;
        
        this.socket.emit('mouse-move', {
            deltaX: deltaX * this.mouseSensitivity,
            deltaY: deltaY * this.mouseSensitivity
        });
    }
    
    /**
     * Send mouse click to server
     */
    sendMouseClick(button = 'left') {
        if (!this.isConnected) return;
        
        this.socket.emit('mouse-click', { button });
        console.log(`🖱️  Mouse ${button} click`);
    }
    
    /**
     * Release all pressed buttons (on disconnect)
     */
    releaseAllButtons() {
        this.pressedButtons.forEach(buttonName => {
            const button = document.querySelector(`[data-button="${buttonName}"]`);
            if (button) {
                button.classList.remove('pressed');
            }
        });
        this.pressedButtons.clear();
    }
    
    /**
     * Show haptic feedback indicator
     */
    showHapticFeedback() {
        // Visual feedback
        this.elements.hapticIndicator.classList.add('active');
        setTimeout(() => {
            this.elements.hapticIndicator.classList.remove('active');
        }, 300);
        
        // Attempt haptic feedback on supported devices
        this.triggerHapticFeedback();
    }
    
    /**
     * Trigger device haptic feedback
     */
    triggerHapticFeedback(duration = 100, intensity = 0.5) {
        // Navigator vibrate API
        if ('vibrate' in navigator) {
            navigator.vibrate(duration);
        }
        
        // Gamepad haptic feedback (if connected)
        if ('getGamepads' in navigator) {
            const gamepads = navigator.getGamepads();
            for (let gamepad of gamepads) {
                if (gamepad && gamepad.vibrationActuator) {
                    gamepad.vibrationActuator.playEffect('dual-rumble', {
                        duration: duration,
                        strongMagnitude: intensity,
                        weakMagnitude: intensity * 0.5
                    });
                }
            }
        }
    }
    
    /**
     * Test vibration functionality
     */
    testVibration() {
        this.triggerHapticFeedback(200, 0.8);
        this.showHapticFeedback();
        
        // Also request server-side vibration test
        if (this.isConnected) {
            this.socket.emit('request-vibration', {
                duration: 200,
                intensity: 0.8
            });
        }
    }
    
    /**
     * Update connection status display
     */
    updateStatus(text, connected) {
        this.elements.statusText.textContent = text;
        if (connected) {
            this.elements.connectionStatus.classList.add('connected');
            this.elements.connectionStatus.classList.remove('disconnected');
        } else {
            this.elements.connectionStatus.classList.remove('connected');
            this.elements.connectionStatus.classList.add('disconnected');
        }
    }
    
    /**
     * Show/hide loading screen
     */
    showLoadingScreen() {
        this.elements.loadingScreen.classList.remove('hidden');
    }
    
    hideLoadingScreen() {
        setTimeout(() => {
            this.elements.loadingScreen.classList.add('hidden');
        }, 500);
    }
    
    /**
     * Show/hide instructions modal
     */
    showInstructionsModal() {
        this.elements.instructionsModal.classList.remove('hidden');
    }
    
    hideInstructionsModal() {
        this.elements.instructionsModal.classList.add('hidden');
    }
    
    /**
     * Prevent context menu on touch devices
     */
    preventContextMenu() {
        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
        
        // Prevent pull-to-refresh
        document.addEventListener('touchstart', (e) => {
            if (e.touches.length > 1) {
                e.preventDefault();
            }
        });
        
        let lastTouchEnd = 0;
        document.addEventListener('touchend', (e) => {
            const now = (new Date()).getTime();
            if (now - lastTouchEnd <= 300) {
                e.preventDefault();
            }
            lastTouchEnd = now;
        }, false);
    }
    
    /**
     * Enable fullscreen mode on mobile devices
     */
    enableFullscreen() {
        // Auto-hide address bar on mobile
        setTimeout(() => {
            window.scrollTo(0, 1);
        }, 100);
        
        // Request fullscreen on user interaction
        document.addEventListener('touchstart', () => {
            if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
                document.documentElement.requestFullscreen().catch(() => {
                    // Fullscreen request failed, ignore
                });
            }
        }, { once: true });
    }
}

// Initialize controller when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('🎮 Initializing Universal Game Controller...');
    const controller = new GameController();
    
    // Make controller accessible globally for debugging
    window.gameController = controller;
    
    // Add orientation change handler
    window.addEventListener('orientationchange', () => {
        setTimeout(() => {
            // Force layout recalculation
            window.scrollTo(0, 0);
            controller.elements.trackpadCursor.style.opacity = '0';
            setTimeout(() => {
                controller.elements.trackpadCursor.style.opacity = '';
            }, 100);
        }, 100);
    });
    
    console.log('✅ Controller initialized successfully!');
});
