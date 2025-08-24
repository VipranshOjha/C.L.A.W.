class MultiTouchGameController {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.controllerNumber = null;
        this.mouseSensitivity = 2;
        this.activeButtons = new Map(); // buttonName -> Set of touch identifiers
        this.activeTouches = new Map(); // touch identifier -> touch data
        
        // Trackpad state
        this.trackpadTouches = new Map(); // touch identifier -> touch data
        this.trackpadClickTimeout = null;
        
        // UI elements
        this.elements = {
            loadingScreen: document.getElementById('loading-screen'),
            instructionsModal: document.getElementById('instructions-modal'),
            statusText: document.getElementById('status-text'),
            connectionStatus: document.getElementById('connection-status'),
            controllerInfo: document.getElementById('controller-info'),
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
        this.setupMultiTouchControls();
        this.preventContextMenu();
        this.enableFullscreen();
    }
    
    /**
     * Initialize WebSocket connection with enhanced error handling
     */
    initializeSocket() {
        console.log('🔌 Connecting to server...');
        this.updateStatus('Connecting...', false);
        
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('✅ Connected to server');
            this.isConnected = true;
            this.updateStatus('Connected', true);
        });
        
        this.socket.on('connected', (data) => {
            console.log('🎮 Controller ready:', data);
            this.controllerNumber = data.controllerNumber;
            this.updateControllerInfo(data);
            this.hideLoadingScreen();
            this.showInstructionsModal();
        });
        
        this.socket.on('connection-rejected', (data) => {
            console.error('❌ Connection rejected:', data.reason);
            this.updateStatus(`Rejected: ${data.reason}`, false);
            alert(`Connection rejected: ${data.reason}`);
        });
        
        this.socket.on('controller-count', (data) => {
            console.log(`🎮 Controllers: ${data.total}/${data.max}`);
        });
        
        this.socket.on('disconnect', (reason) => {
            console.log('❌ Disconnected:', reason);
            this.isConnected = false;
            this.controllerNumber = null;
            this.updateStatus('Disconnected', false);
            this.showLoadingScreen();
            this.releaseAllButtons();
        });
        
        this.socket.on('vibrate', (data) => {
            this.triggerHapticFeedback(data.duration, data.intensity);
        });
        
        this.socket.on('connect_error', (error) => {
            console.error('💥 Connection error:', error);
            this.updateStatus('Connection Error', false);
        });
        
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
     * Setup event listeners for UI controls
     */
    setupEventListeners() {
        // Mouse sensitivity control
        this.elements.mouseSensitivity.addEventListener('input', (e) => {
            this.mouseSensitivity = parseFloat(e.target.value);
            this.elements.sensitivityValue.textContent = `${this.mouseSensitivity}x`;
        });
        
        // Vibration test
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
        
        // Prevent unwanted scrolling and zooming
        document.addEventListener('touchmove', (e) => {
            if (!this.elements.trackpad.contains(e.target)) {
                e.preventDefault();
            }
        }, { passive: false });
        
        document.addEventListener('gesturestart', (e) => e.preventDefault());
        document.addEventListener('gesturechange', (e) => e.preventDefault());
    }
    
    /**
     * Setup multi-touch controls for all buttons and trackpad
     */
    setupMultiTouchControls() {
        // Setup multi-touch for all control buttons
        document.querySelectorAll('[data-button]').forEach(element => {
            this.setupButtonMultiTouch(element);
        });
        
        // Setup trackpad multi-touch
        this.setupTrackpadMultiTouch();
    }
    
    /**
     * Setup multi-touch handling for individual buttons
     */
    setupButtonMultiTouch(element) {
        const buttonName = element.getAttribute('data-button');
        
        // Touch events
        element.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.handleButtonTouchStart(buttonName, element, e);
        }, { passive: false });
        
        element.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.handleButtonTouchEnd(buttonName, element, e);
        }, { passive: false });
        
        element.addEventListener('touchcancel', (e) => {
            e.preventDefault();
            this.handleButtonTouchEnd(buttonName, element, e);
        }, { passive: false });
        
        // Mouse events for desktop testing
        element.addEventListener('mousedown', (e) => {
            e.preventDefault();
            this.simulateTouch(buttonName, element, true);
        });
        
        element.addEventListener('mouseup', (e) => {
            e.preventDefault();
            this.simulateTouch(buttonName, element, false);
        });
        
        // Prevent context menu and selection
        element.addEventListener('contextmenu', (e) => e.preventDefault());
        element.addEventListener('selectstart', (e) => e.preventDefault());
    }
    
    /**
     * Handle button touch start with multi-touch support
     */
    handleButtonTouchStart(buttonName, element, event) {
        if (!this.isConnected) return;
        
        const currentTouches = this.activeButtons.get(buttonName) || new Set();
        
        // Add all new touches for this button
        Array.from(event.changedTouches).forEach(touch => {
            currentTouches.add(touch.identifier);
        });
        
        this.activeButtons.set(buttonName, currentTouches);
        
        // If this is the first touch on this button, press it
        if (currentTouches.size === event.changedTouches.length) {
            element.classList.add('pressed');
            this.socket.emit('button-press', { button: buttonName });
            this.showHapticFeedback();
            console.log(`🎮 Button pressed: ${buttonName}`);
        }
    }
    
    /**
     * Handle button touch end with multi-touch support
     */
    handleButtonTouchEnd(buttonName, element, event) {
        if (!this.isConnected) return;
        
        const currentTouches = this.activeButtons.get(buttonName) || new Set();
        
        // Remove ended touches
        Array.from(event.changedTouches).forEach(touch => {
            currentTouches.delete(touch.identifier);
        });
        
        this.activeButtons.set(buttonName, currentTouches);
        
        // If no more touches on this button, release it
        if (currentTouches.size === 0) {
            element.classList.remove('pressed');
            this.socket.emit('button-release', { button: buttonName });
            this.activeButtons.delete(buttonName);
            console.log(`🎮 Button released: ${buttonName}`);
        }
    }
    
    /**
     * Setup trackpad multi-touch handling
     */
    setupTrackpadMultiTouch() {
        const trackpad = this.elements.trackpad;
        
        trackpad.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.handleTrackpadTouchStart(e);
        }, { passive: false });
        
        trackpad.addEventListener('touchmove', (e) => {
            e.preventDefault();
            this.handleTrackpadTouchMove(e);
        }, { passive: false });
        
        trackpad.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.handleTrackpadTouchEnd(e);
        }, { passive: false });
        
        trackpad.addEventListener('touchcancel', (e) => {
            e.preventDefault();
            this.handleTrackpadTouchEnd(e);
        }, { passive: false });
        
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
    handleTrackpadTouchStart(event) {
        const rect = this.elements.trackpad.getBoundingClientRect();
        
        Array.from(event.changedTouches).forEach(touch => {
            this.trackpadTouches.set(touch.identifier, {
                startX: touch.clientX - rect.left,
                startY: touch.clientY - rect.top,
                lastX: touch.clientX - rect.left,
                lastY: touch.clientY - rect.top,
                startTime: Date.now(),
                moved: false
            });
        });
        
        this.elements.trackpad.classList.add('active');
        this.updateTrackpadCursor(event.touches[0]);
    }
    
    /**
     * Handle trackpad touch movement
     */
    handleTrackpadTouchMove(event) {
        if (!this.isConnected) return;
        
        const rect = this.elements.trackpad.getBoundingClientRect();
        
        Array.from(event.changedTouches).forEach(touch => {
            const touchData = this.trackpadTouches.get(touch.identifier);
            if (!touchData) return;
            
            const currentX = touch.clientX - rect.left;
            const currentY = touch.clientY - rect.top;
            
            const deltaX = currentX - touchData.lastX;
            const deltaY = currentY - touchData.lastY;
            
            // Mark as moved if significant movement
            if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
                touchData.moved = true;
                
                // Send movement only for the primary touch
                if (event.touches.identifier === touch.identifier) {
                    this.sendMouseMove(deltaX, deltaY);
                }
            }
            
            touchData.lastX = currentX;
            touchData.lastY = currentY;
        });
        
        this.updateTrackpadCursor(event.touches);
    }
    
    /**
     * Handle trackpad touch end with tap detection
     */
    handleTrackpadTouchEnd(event) {
        const endedTouches = Array.from(event.changedTouches);
        const remainingTouches = Array.from(event.touches);
        
        // Process ended touches
        const tapTouches = [];
        endedTouches.forEach(touch => {
            const touchData = this.trackpadTouches.get(touch.identifier);
            if (touchData) {
                const duration = Date.now() - touchData.startTime;
                // Consider it a tap if not moved much and quick duration
                if (!touchData.moved && duration < 300) {
                    tapTouches.push(touch);
                }
                this.trackpadTouches.delete(touch.identifier);
            }
        });
        
        // Handle tap detection
        if (tapTouches.length > 0 && remainingTouches.length === 0) {
            const tapType = tapTouches.length === 1 ? 'left' : 'right';
            this.sendMouseClick(tapType);
            this.showHapticFeedback();
        }
        
        // Update UI state
        if (remainingTouches.length === 0) {
            this.elements.trackpad.classList.remove('active');
        } else if (remainingTouches.length > 0) {
            this.updateTrackpadCursor(remainingTouches[0]);
        }
    }
    
    /**
     * Update trackpad cursor position
     */
    updateTrackpadCursor(touch) {
        const rect = this.elements.trackpad.getBoundingClientRect();
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        
        this.elements.trackpadCursor.style.left = `${x}px`;
        this.elements.trackpadCursor.style.top = `${y}px`;
        this.elements.trackpadCursor.style.opacity = '1';
    }
    
    /**
     * Mouse event handlers for desktop testing
     */
    startTrackpadMouse(event) {
        const rect = this.elements.trackpad.getBoundingClientRect();
        this.mouseTrackingData = {
            lastX: event.clientX - rect.left,
            lastY: event.clientY - rect.top,
            tracking: true
        };
        this.elements.trackpad.classList.add('active');
    }
    
    handleTrackpadMouseMove(event) {
        if (!this.mouseTrackingData?.tracking || !this.isConnected) return;
        
        const rect = this.elements.trackpad.getBoundingClientRect();
        const currentX = event.clientX - rect.left;
        const currentY = event.clientY - rect.top;
        
        const deltaX = currentX - this.mouseTrackingData.lastX;
        const deltaY = currentY - this.mouseTrackingData.lastY;
        
        this.sendMouseMove(deltaX, deltaY);
        
        this.mouseTrackingData.lastX = currentX;
        this.mouseTrackingData.lastY = currentY;
    }
    
    endTrackpadMouse(event) {
        if (this.mouseTrackingData?.tracking) {
            const button = event.button === 2 ? 'right' : 'left';
            this.sendMouseClick(button);
        }
        
        this.mouseTrackingData = null;
        this.elements.trackpad.classList.remove('active');
        this.elements.trackpadCursor.style.opacity = '0';
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
        console.log(`🖱️ Mouse ${button} click`);
    }
    
    /**
     * Simulate touch events for mouse testing
     */
    simulateTouch(buttonName, element, pressed) {
        if (pressed) {
            element.classList.add('pressed');
            this.socket.emit('button-press', { button: buttonName });
            this.showHapticFeedback();
        } else {
            element.classList.remove('pressed');
            this.socket.emit('button-release', { button: buttonName });
        }
    }
    
    /**
     * Release all pressed buttons on disconnect
     */
    releaseAllButtons() {
        this.activeButtons.forEach((touches, buttonName) => {
            const element = document.querySelector(`[data-button="${buttonName}"]`);
            if (element) {
                element.classList.remove('pressed');
            }
        });
        this.activeButtons.clear();
        this.trackpadTouches.clear();
    }
    
    /**
     * Show haptic feedback indicator
     */
    showHapticFeedback() {
        this.elements.hapticIndicator.classList.add('active');
        setTimeout(() => {
            this.elements.hapticIndicator.classList.remove('active');
        }, 300);
        
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
        
        // Gamepad haptic feedback
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
     * Update controller information display
     */
    updateControllerInfo(data) {
        if (this.elements.controllerInfo) {
            this.elements.controllerInfo.textContent = 
                `Controller ${data.controllerNumber} (${data.totalControllers}/${data.maxControllers})`;
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
     * Prevent context menu and unwanted interactions
     */
    preventContextMenu() {
        document.addEventListener('contextmenu', (e) => e.preventDefault());
        
        // Prevent pull-to-refresh
        document.addEventListener('touchstart', (e) => {
            if (e.touches.length > 1) {
                e.preventDefault();
            }
        });
        
        // Prevent double-tap zoom
        let lastTouchEnd = 0;
        document.addEventListener('touchend', (e) => {
            const now = Date.now();
            if (now - lastTouchEnd <= 300) {
                e.preventDefault();
            }
            lastTouchEnd = now;
        }, false);
    }
    
    /**
     * Enable fullscreen mode on mobile
     */
    enableFullscreen() {
        // Auto-hide address bar
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
    console.log('🎮 Initializing Multi-Touch Game Controller...');
    const controller = new MultiTouchGameController();
    
    // Make controller accessible globally for debugging
    window.gameController = controller;
    
    // Handle orientation changes
    window.addEventListener('orientationchange', () => {
        setTimeout(() => {
            window.scrollTo(0, 0);
            if (controller.elements.trackpadCursor) {
                controller.elements.trackpadCursor.style.opacity = '0';
                setTimeout(() => {
                    controller.elements.trackpadCursor.style.opacity = '';
                }, 100);
            }
        }, 100);
    });
    
    console.log('✅ Multi-Touch Controller initialized successfully!');
});

