const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const vigem = require('node-vigem');
const qrcode = require('qrcode');
const ip = require('ip');
const path = require('path');

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Configuration constants
const PORT = 3000;
const MAX_CONTROLLERS = 4;
const STICK_SENSITIVITY = 0.8;
const STICK_DEADZONE = 0.1;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Controller management
let vigemClient = null;
let connectedControllers = new Map(); // socketId -> controller info
let controllerCount = 0;

/**
 * Initialize ViGEm client
 */
function initializeViGEm() {
    try {
        vigemClient = vigem.createClient();
        console.log('✅ ViGEm client initialized successfully');
        return true;
    } catch (error) {
        console.error('❌ Failed to initialize ViGEm client:', error.message);
        console.error('💡 Make sure ViGEmBus driver is installed and you\'re running as Administrator');
        return false;
    }
}

/**
 * Create a new virtual Xbox 360 controller
 */
function createVirtualController(socketId, controllerNumber) {
    try {
        const controller = vigem.createX360Controller();
        vigemClient.connect(controller);
        
        const controllerInfo = {
            controller: controller,
            number: controllerNumber,
            socketId: socketId,
            pressedButtons: new Set(),
            leftStick: { x: 0, y: 0 },
            rightStick: { x: 0, y: 0 },
            leftTrigger: 0,
            rightTrigger: 0
        };
        
        connectedControllers.set(socketId, controllerInfo);
        console.log(`🎮 Virtual Controller ${controllerNumber} created for socket ${socketId}`);
        return controllerInfo;
        
    } catch (error) {
        console.error('❌ Error creating virtual controller:', error.message);
        return null;
    }
}

/**
 * Destroy virtual controller
 */
function destroyVirtualController(socketId) {
    const controllerInfo = connectedControllers.get(socketId);
    if (controllerInfo) {
        try {
            vigemClient.disconnect(controllerInfo.controller);
            connectedControllers.delete(socketId);
            console.log(`🎮 Virtual Controller ${controllerInfo.number} destroyed`);
        } catch (error) {
            console.error('❌ Error destroying controller:', error.message);
        }
    }
}

/**
 * Map controller buttons to Xbox 360 button constants
 */
const BUTTON_MAP = {
    'dpad-up': vigem.X360Buttons.DPAD_UP,
    'dpad-down': vigem.X360Buttons.DPAD_DOWN,
    'dpad-left': vigem.X360Buttons.DPAD_LEFT,
    'dpad-right': vigem.X360Buttons.DPAD_RIGHT,
    'action-jump': vigem.X360Buttons.A,
    'action-run': vigem.X360Buttons.X,
    'action-interact': vigem.X360Buttons.B,
    'action-crouch': vigem.X360Buttons.Y,
    'left-click': vigem.X360Buttons.LEFT_SHOULDER,
    'right-click': vigem.X360Buttons.RIGHT_SHOULDER,
    'menu': vigem.X360Buttons.START,
    'back': vigem.X360Buttons.BACK
};

/**
 * Handle button press/release
 */
function handleButton(socketId, buttonName, pressed) {
    const controllerInfo = connectedControllers.get(socketId);
    if (!controllerInfo) return;
    
    const xboxButton = BUTTON_MAP[buttonName];
    if (!xboxButton) return;
    
    try {
        if (pressed) {
            controllerInfo.pressedButtons.add(buttonName);
            controllerInfo.controller.button(xboxButton, true);
        } else {
            controllerInfo.pressedButtons.delete(buttonName);
            controllerInfo.controller.button(xboxButton, false);
        }
        
        console.log(`🎮 Controller ${controllerInfo.number}: ${buttonName} ${pressed ? 'pressed' : 'released'}`);
    } catch (error) {
        console.error('❌ Button handling error:', error.message);
    }
}

/**
 * Handle analog stick movement
 */
function handleStickMovement(socketId, stickData) {
    const controllerInfo = connectedControllers.get(socketId);
    if (!controllerInfo) return;
    
    try {
        // Map trackpad movement to right analog stick (camera control)
        let x = Math.max(-1, Math.min(1, stickData.deltaX * STICK_SENSITIVITY));
        let y = Math.max(-1, Math.min(1, stickData.deltaY * STICK_SENSITIVITY));
        
        // Apply deadzone
        if (Math.abs(x) < STICK_DEADZONE) x = 0;
        if (Math.abs(y) < STICK_DEADZONE) y = 0;
        
        // Convert to Xbox 360 stick range (-32768 to 32767)
        const stickX = Math.round(x * 32767);
        const stickY = Math.round(-y * 32767); // Invert Y axis for natural camera movement
        
        controllerInfo.rightStick.x = stickX;
        controllerInfo.rightStick.y = stickY;
        
        controllerInfo.controller.axis(vigem.X360Axes.RIGHT_STICK_X, stickX);
        controllerInfo.controller.axis(vigem.X360Axes.RIGHT_STICK_Y, stickY);
        
        // Update controller state
        controllerInfo.controller.updateState();
        
    } catch (error) {
        console.error('❌ Stick movement error:', error.message);
    }
}

/**
 * Handle mouse click events
 */
function handleMouseClick(socketId, clickData) {
    const buttonName = clickData.button === 'right' ? 'right-click' : 'left-click';
    
    // Simulate button press and release for click
    handleButton(socketId, buttonName, true);
    setTimeout(() => {
        handleButton(socketId, buttonName, false);
    }, 100);
}

/**
 * Get next available controller number
 */
function getNextControllerNumber() {
    const usedNumbers = Array.from(connectedControllers.values()).map(info => info.number);
    for (let i = 1; i <= MAX_CONTROLLERS; i++) {
        if (!usedNumbers.includes(i)) {
            return i;
        }
    }
    return null;
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    // Check if max controllers reached
    if (controllerCount >= MAX_CONTROLLERS) {
        socket.emit('connection-rejected', {
            reason: 'Maximum number of controllers reached',
            maxControllers: MAX_CONTROLLERS
        });
        socket.disconnect();
        return;
    }
    
    const controllerNumber = getNextControllerNumber();
    if (!controllerNumber) {
        socket.emit('connection-rejected', {
            reason: 'No controller slots available'
        });
        socket.disconnect();
        return;
    }
    
    // Create virtual controller
    const controllerInfo = createVirtualController(socket.id, controllerNumber);
    if (!controllerInfo) {
        socket.emit('connection-rejected', {
            reason: 'Failed to create virtual controller'
        });
        socket.disconnect();
        return;
    }
    
    controllerCount++;
    console.log(`📱 Controller ${controllerNumber} connected! (${controllerCount}/${MAX_CONTROLLERS} total)`);
    
    // Send connection confirmation
    socket.emit('connected', {
        message: 'Controller connected successfully!',
        controllerNumber: controllerNumber,
        totalControllers: controllerCount,
        maxControllers: MAX_CONTROLLERS
    });
    
    // Broadcast controller count to all clients
    io.emit('controller-count', {
        total: controllerCount,
        max: MAX_CONTROLLERS
    });
    
    // Handle button events
    socket.on('button-press', (data) => {
        handleButton(socket.id, data.button, true);
    });
    
    socket.on('button-release', (data) => {
        handleButton(socket.id, data.button, false);
    });
    
    // Handle mouse/trackpad events
    socket.on('mouse-move', (data) => {
        handleStickMovement(socket.id, data);
    });
    
    socket.on('mouse-click', (data) => {
        handleMouseClick(socket.id, data);
    });
    
    // Handle controller vibration
    socket.on('request-vibration', (data) => {
        const controllerInfo = connectedControllers.get(socket.id);
        if (controllerInfo) {
            try {
                const intensity = Math.min(1, Math.max(0, data.intensity || 0.5));
                const duration = Math.min(5000, Math.max(100, data.duration || 100));
                
                // Set vibration on virtual controller
                controllerInfo.controller.axis(vigem.X360Axes.LEFT_MOTOR, Math.round(intensity * 255));
                controllerInfo.controller.axis(vigem.X360Axes.RIGHT_MOTOR, Math.round(intensity * 255));
                controllerInfo.controller.updateState();
                
                // Stop vibration after duration
                setTimeout(() => {
                    controllerInfo.controller.axis(vigem.X360Axes.LEFT_MOTOR, 0);
                    controllerInfo.controller.axis(vigem.X360Axes.RIGHT_MOTOR, 0);
                    controllerInfo.controller.updateState();
                }, duration);
                
                // Echo back to client for haptic feedback
                socket.emit('vibrate', {
                    duration: duration,
                    intensity: intensity
                });
            } catch (error) {
                console.error('❌ Vibration error:', error.message);
            }
        }
    });
    
    // Handle disconnection
    socket.on('disconnect', (reason) => {
        const controllerInfo = connectedControllers.get(socket.id);
        if (controllerInfo) {
            console.log(`📱 Controller ${controllerInfo.number} disconnected: ${reason}`);
            
            // Release all pressed buttons
            controllerInfo.pressedButtons.forEach(buttonName => {
                const xboxButton = BUTTON_MAP[buttonName];
                if (xboxButton) {
                    try {
                        controllerInfo.controller.button(xboxButton, false);
                    } catch (error) {
                        console.error(`❌ Error releasing button ${buttonName}:`, error.message);
                    }
                }
            });
            
            // Reset sticks and triggers
            try {
                controllerInfo.controller.axis(vigem.X360Axes.RIGHT_STICK_X, 0);
                controllerInfo.controller.axis(vigem.X360Axes.RIGHT_STICK_Y, 0);
                controllerInfo.controller.axis(vigem.X360Axes.LEFT_STICK_X, 0);
                controllerInfo.controller.axis(vigem.X360Axes.LEFT_STICK_Y, 0);
                controllerInfo.controller.updateState();
            } catch (error) {
                console.error('❌ Error resetting controller state:', error.message);
            }
            
            destroyVirtualController(socket.id);
            controllerCount--;
            
            // Broadcast updated controller count
            io.emit('controller-count', {
                total: controllerCount,
                max: MAX_CONTROLLERS
            });
        }
    });
    
    // Handle errors
    socket.on('error', (error) => {
        console.error('❌ Socket error:', error);
    });
});

// Generate and display connection info
async function displayConnectionInfo() {
    const localIP = ip.address();
    const serverURL = `http://${localIP}:${PORT}`;
    
    console.log('\n' + '='.repeat(70));
    console.log('🎮 MULTI-CONTROLLER GAMEPAD SYSTEM v2.0');
    console.log('='.repeat(70));
    console.log(`📡 Server running on: ${serverURL}`);
    console.log(`🌐 Local IP Address: ${localIP}`);
    console.log(`🔌 Port: ${PORT}`);
    console.log(`🎯 Max Controllers: ${MAX_CONTROLLERS}`);
    console.log('\n📱 CONNECT YOUR PHONES:');
    console.log(' 1. Ensure ViGEmBus driver is installed');
    console.log(' 2. Connect phones to same Wi-Fi network');
    console.log(' 3. Scan QR code below with phone camera');
    console.log(' 4. Each phone becomes a unique Xbox controller');
    console.log('\n' + '='.repeat(70));
    
    try {
        const qrString = await qrcode.toString(serverURL, {
            type: 'terminal',
            small: true,
            margin: 1
        });
        console.log(qrString);
    } catch (error) {
        console.error('❌ Error generating QR code:', error.message);
        console.log(`📱 Manual connection: Open ${serverURL} on your phone`);
    }
    
    console.log('='.repeat(70));
    console.log('🎯 Ready for controllers! Waiting for connections...\n');
}

// Error handling
process.on('uncaughtException', (error) => {
    if (error.message.includes('vigem') || error.message.includes('ViGEm')) {
        console.error('❌ ViGEm Error - Make sure:');
        console.error('  1. ViGEmBus driver is installed');
        console.error('  2. You are running as Administrator');
        console.error('  3. Your system supports ViGEm');
    } else {
        console.error('❌ Uncaught Exception:', error);
    }
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🔄 Shutting down server...');
    
    // Clean up all controllers
    connectedControllers.forEach((controllerInfo, socketId) => {
        destroyVirtualController(socketId);
    });
    
    if (vigemClient) {
        try {
            vigemClient.dispose();
        } catch (error) {
            console.error('❌ Error disposing ViGEm client:', error.message);
        }
    }
    
    server.close(() => {
        console.log('✅ Server shut down gracefully');
        process.exit(0);
    });
});

// Initialize and start server
if (initializeViGEm()) {
    server.listen(PORT, () => {
        displayConnectionInfo();
    });
} else {
    console.error('❌ Failed to initialize ViGEm. Server cannot start.');
    console.error('💡 Please install ViGEmBus driver and run as Administrator');
    process.exit(1);
}
