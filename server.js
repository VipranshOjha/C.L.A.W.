const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const robot = require('robotjs');
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
const MOUSE_SENSITIVITY = 2; // Adjust mouse movement sensitivity
const DEBOUNCE_TIME = 50; // Milliseconds between rapid inputs

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Store connected clients and input states
let connectedClients = 0;
let lastInputTime = 0;
let pressedKeys = new Set(); // Track currently pressed keys

// Configure robotjs for better performance
robot.setMouseDelay(1);
robot.setKeyboardDelay(1);

/**
 * Debounce function to prevent input spam
 */
function shouldProcessInput() {
    const now = Date.now();
    if (now - lastInputTime < DEBOUNCE_TIME) {
        return false;
    }
    lastInputTime = now;
    return true;
}

/**
 * Process keyboard input from controller
 */
function handleKeyboardInput(action, key) {
    if (!shouldProcessInput()) return;
    
    try {
        switch (action) {
            case 'press':
                if (!pressedKeys.has(key)) {
                    robot.keyToggle(key, 'down');
                    pressedKeys.add(key);
                }
                break;
            case 'release':
                if (pressedKeys.has(key)) {
                    robot.keyToggle(key, 'up');
                    pressedKeys.delete(key);
                }
                break;
            case 'tap':
                robot.keyTap(key);
                break;
        }
        console.log(`🎮 ${action.toUpperCase()}: ${key}`);
    } catch (error) {
        console.error('❌ Keyboard input error:', error.message);
    }
}

/**
 * Process mouse input from controller
 */
function handleMouseInput(action, data) {
    try {
        switch (action) {
            case 'move':
                if (data.deltaX !== 0 || data.deltaY !== 0) {
                    const currentPos = robot.getMousePos();
                    const newX = Math.max(0, currentPos.x + (data.deltaX * MOUSE_SENSITIVITY));
                    const newY = Math.max(0, currentPos.y + (data.deltaY * MOUSE_SENSITIVITY));
                    robot.moveMouse(newX, newY);
                }
                break;
            case 'click':
                robot.mouseClick(data.button || 'left');
                console.log(`🖱️  Mouse ${data.button || 'left'} click`);
                break;
        }
    } catch (error) {
        console.error('❌ Mouse input error:', error.message);
    }
}

/**
 * Map controller buttons to keyboard keys
 */
function mapButtonToKey(buttonName) {
    const keyMap = {
        // D-pad controls
        'dpad-up': 'w',
        'dpad-down': 's', 
        'dpad-left': 'a',
        'dpad-right': 'd',
        
        // Action buttons
        'action-jump': 'space',
        'action-run': 'shift',
        'action-interact': 'e',
        'action-crouch': 'control',
        
        // Additional controls (can be customized)
        'action-reload': 'r',
        'action-map': 'm',
        'action-inventory': 'i',
        'action-escape': 'escape'
    };
    
    return keyMap[buttonName] || buttonName;
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    connectedClients++;
    console.log(`📱 New controller connected! (${connectedClients} total)`);
    console.log(`   Socket ID: ${socket.id}`);
    
    // Send connection confirmation
    socket.emit('connected', {
        message: 'Controller connected successfully!',
        clientCount: connectedClients
    });
    
    // Handle button press events
    socket.on('button-press', (data) => {
        const key = mapButtonToKey(data.button);
        handleKeyboardInput('press', key);
    });
    
    // Handle button release events
    socket.on('button-release', (data) => {
        const key = mapButtonToKey(data.button);
        handleKeyboardInput('release', key);
    });
    
    // Handle button tap events (press and immediate release)
    socket.on('button-tap', (data) => {
        const key = mapButtonToKey(data.button);
        handleKeyboardInput('tap', key);
    });
    
    // Handle mouse movement from trackpad
    socket.on('mouse-move', (data) => {
        handleMouseInput('move', data);
    });
    
    // Handle mouse clicks
    socket.on('mouse-click', (data) => {
        handleMouseInput('click', data);
    });
    
    // Handle controller vibration (if supported by client)
    socket.on('request-vibration', (data) => {
        // Echo vibration request back to client
        socket.emit('vibrate', {
            duration: data.duration || 100,
            intensity: data.intensity || 0.5
        });
    });
    
    // Handle disconnection
    socket.on('disconnect', (reason) => {
        connectedClients--;
        console.log(`📱 Controller disconnected: ${reason}`);
        console.log(`   Controllers remaining: ${connectedClients}`);
        
        // Release all keys that might be stuck pressed
        pressedKeys.forEach(key => {
            try {
                robot.keyToggle(key, 'up');
            } catch (error) {
                console.error(`❌ Error releasing key ${key}:`, error.message);
            }
        });
        pressedKeys.clear();
    });
    
    // Handle errors
    socket.on('error', (error) => {
        console.error('❌ Socket error:', error);
    });
});

// Generate and display QR code
async function displayConnectionInfo() {
    const localIP = ip.address();
    const serverURL = `http://${localIP}:${PORT}`;
    
    console.log('\n' + '='.repeat(60));
    console.log('🎮 UNIVERSAL SMARTPHONE GAME CONTROLLER');
    console.log('='.repeat(60));
    console.log(`📡 Server running on: ${serverURL}`);
    console.log(`🌐 Local IP Address: ${localIP}`);
    console.log(`🔌 Port: ${PORT}`);
    console.log('\n📱 CONNECT YOUR PHONE:');
    console.log('   1. Connect phone to same Wi-Fi network');
    console.log('   2. Scan QR code below with phone camera');
    console.log('   3. Controller will open in browser');
    console.log('\n' + '='.repeat(60));
    
    try {
        // Generate QR code for easy connection
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
    
    console.log('='.repeat(60));
    console.log('🎯 Ready for connections! Waiting for controllers...\n');
}

// Error handling for robotjs
process.on('uncaughtException', (error) => {
    if (error.message.includes('robotjs')) {
        console.error('❌ RobotJS Error - Make sure to run as administrator/sudo');
        console.error('   This is required for input simulation to work properly');
    } else {
        console.error('❌ Uncaught Exception:', error);
    }
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🔄 Shutting down server...');
    
    // Release all pressed keys
    pressedKeys.forEach(key => {
        try {
            robot.keyToggle(key, 'up');
        } catch (error) {
            // Ignore errors during shutdown
        }
    });
    
    server.close(() => {
        console.log('✅ Server shut down gracefully');
        process.exit(0);
    });
});

// Start the server
server.listen(PORT, () => {
    displayConnectionInfo();
});