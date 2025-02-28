import express from 'express';
import Docker from 'dockerode'; // Import the Docker constructor, not 'docker'
import { v4 as uuidv4 } from 'uuid'; // uuid's ES module import style
import path from 'path';
import getPort from 'get-port';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const sqlite3 = require('sqlite3');
import cors from 'cors'; // Import CORS package

// Initialize Dockerode
const docker = new Docker();  // <-- Correct initialization

// Initialize Express app
const app = express();  
app.disable('x-powered-by');

// SQLite database connection
const db = new sqlite3.Database('./containers.db', (err) => {
    if (err) {
        console.error("Error connecting to database:", err.message);
    } else {
        console.log("Connected to SQLite database.");
    }
});

// Create a table to store container info (id, start_time)
db.run(`
    CREATE TABLE IF NOT EXISTS containers (
        id TEXT PRIMARY KEY,
        start_time INTEGER,
        port1 INTEGER,
        port2 INTEGER
    )
`);

// Sample API key for authorization (you can generate and store these securely)
const API_KEY = 'your-api-key-here'; // Replace with a securely generated API key

app.use(express.json());

// Enable CORS for all origins
app.use(cors({
  origin: '*', // Allow all origins
  methods: ['GET', 'POST', 'DELETE'], // Allow only GET, POST, DELETE methods
  allowedHeaders: ['Content-Type', 'Authorization'], // Allow only specific headers
}));

// Middleware for API key validation
const validateApiKey = (req, res, next) => {
    const apiKey = req.headers['authorization'];
    if (apiKey !== `Bearer ${API_KEY}`) {
        console.warn(`Unauthorized access attempt: Invalid API Key - ${req.ip}`);
        return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
    }
    console.log(`Authorized request from ${req.ip} to ${req.originalUrl}`);
    next(); // Proceed to the next middleware or route handler
};

app.use(validateApiKey); // Apply the API key validation middleware globally

const CHROMIUM_IMAGE = 'linuxserver/chromium:latest';

// Function to get an available port (simple example, it can be improved)
const getAvailablePort = () => {
    const port = getPort();
    console.log(`Generated available port: ${port}`);
    return port;
};

// Utility function to add timeout to any promise
const withTimeout = (promise, timeout) => {
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timeout exceeded')), timeout);
    });
    return Promise.race([promise, timeoutPromise]);
};

// Function to automatically delete containers after 4 hours (14,400,000 ms)
const autoDeleteContainer = (containerId, startTime) => {
    const deleteTimeout = 14400000; // 4 hours in milliseconds
    setTimeout(async () => {
        try {
            console.log(`Scheduled deletion for container ${containerId}`);
            const container = docker.getContainer(containerId);
            await container.stop();
            await container.remove();
            // Delete the record from the database
            db.run("DELETE FROM containers WHERE id = ?", [containerId], function (err) {
                if (err) {
                    console.error("Error deleting from database:", err.message);
                }
            });
            console.log(`Container ${containerId} deleted automatically after 4 hours`);
        } catch (error) {
            console.error(`Error deleting container ${containerId} after 4 hours:`, error);
        }
    }, deleteTimeout);
};

// Endpoint to create the container
app.post('/create-container', async (req, res) => {
    try {
        console.log(`Received request to create container from ${req.ip}`);
        
        // Dynamically assign ports (3000 and 3001 for this example)
        const port1 = await getAvailablePort();  // Make sure to await the promise to get the port
        const port2 = await getAvailablePort();  // Same here for port2

        // Define environment variables similar to the Compose file
        const environment = [
            'PUID=1000',
            'PGID=1000',
            'TZ=Etc/UTC',
            'CHROME_CLI=chrome://newtab', // Optional Chrome CLI arg
        ];

        // Define volume path (Optional: can be passed in request or configured here)
        const volumePath = '/path/to/config'; // Change this to your volume path

        // Create a container from the image
        console.log(`Creating container with image: ${CHROMIUM_IMAGE}`);
        const container = await docker.createContainer({
            Image: CHROMIUM_IMAGE,
            name: `chromium-container-${Date.now()}`,
            Tty: true,  // Keep the terminal open for the container
            Env: environment,  // Pass environment variables
            Volumes: {
                '/config': {}  // Bind mount the config volume
            },
            HostConfig: {
                Binds: [`${volumePath}:/config`], // Mount the volume
                PortBindings: {
                    '3000/tcp': [{ HostPort: `${port1}` }], // Map port 3000 in container to a random port on the host
                    '3001/tcp': [{ HostPort: `${port2}` }]  // Map port 3001 in container to another random host port
                },
                shm_size: '512m',  // Shared memory size
            },
            security_opt: ['seccomp:unconfined'], // Optional security option
        });

        // Start the container
        await container.start();
        console.log(`Container ${container.id} started successfully`);

        // Store container data (store container instance, not just the ID)
        const startTime = Date.now();
        db.run("INSERT INTO containers (id, start_time, port1, port2) VALUES (?, ?, ?, ?)", 
            [container.id, startTime, port1, port2], function(err) {
                if (err) {
                    console.error("Error inserting into database:", err.message);
                } else {
                    console.log(`Container ${container.id} saved to database`);
                }
            });

        // Schedule automatic deletion after 4 hours
        autoDeleteContainer(container.id, startTime);

        // Immediately return the response with container UUID and assigned ports
        console.log(`Returning response for container creation`);
        res.status(200).json({
            message: 'Container created successfully',
            uuid: container.id,
            ports: { port1, port2 },
        });

    } catch (error) {
        console.error('Error creating container:', error);
        res.status(500).json({ error: error.message || 'Failed to create container' });
    }
});

// Endpoint to delete the container manually
app.delete('/delete-container/:uuid', async (req, res) => {
    const { uuid } = req.params;
    try {
        console.log(`Received request to delete container ${uuid} from ${req.ip}`);

        // Retrieve the container from the database
        db.get("SELECT * FROM containers WHERE id = ?", [uuid], async (err, row) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            if (!row) {
                return res.status(404).json({ error: 'Container not found' });
            }

            // Stop and remove the container
            const container = docker.getContainer(uuid);
            await container.stop();
            await container.remove();

            // Remove from the database
            db.run("DELETE FROM containers WHERE id = ?", [uuid], function(err) {
                if (err) {
                    console.error("Error deleting from database:", err.message);
                }
            });

            console.log(`Container ${uuid} stopped and removed`);
            res.status(200).json({
                message: `Container ${uuid} deleted successfully`,
            });
        });

    } catch (error) {
        console.error(`Error deleting container ${uuid}:`, error);
        res.status(500).json({ error: 'Failed to delete container' });
    }
});

// Start the Express server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
