import express from 'express';
import Docker from 'dockerode'; 
import { v4 as uuidv4 } from 'uuid'; 
import getPort from 'get-port';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const sqlite3 = require('sqlite3');
import cors from 'cors'; 
import sanitizer from 'sanitizer';

const docker = new Docker();

const app = express();
app.disable('x-powered-by');

// Database initialization
const db = new sqlite3.Database('./containers.db', (err) => {
    if (err) {
        console.error("Error connecting to database:", err.message);
    } else {
        console.log("Connected to SQLite database.");
    }
});

db.run(`
    CREATE TABLE IF NOT EXISTS containers (
        id TEXT PRIMARY KEY,
        start_time INTEGER,
        port1 INTEGER,
        port2 INTEGER
    )
`);

let API_KEY;

if (process.env.API_KEY && process.env.API_KEY.trim() !== '') {
  API_KEY = process.env.API_KEY;
} else {
  API_KEY = require('crypto').randomBytes(24).toString('hex');
}

console.log("API_KEY: " + API_KEY);

app.use(express.json());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

const validateApiKey = (req, res, next) => {
    const apiKey = req.headers['authorization'];
    console.log(`Received API Key: ${apiKey}`);  // Log incoming API Key for debugging
    if (apiKey !== `Bearer ${API_KEY}`) {
        console.warn(`Unauthorized access attempt: Invalid API Key - ${req.ip}`);
        return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
    }
    console.log(`Authorized request from ${req.ip} to ${req.originalUrl}`);
    next();  // Proceed to the next middleware or route handler
};

app.use(validateApiKey);  // Apply the API key validation middleware globally

const CHROMIUM_IMAGE = 'linuxserver/chromium:latest';

async function getAvailablePort() {
    const port = await getPort();
    console.log(`Generated available port: ${port}`);
    return port;
}

const withTimeout = (promise, timeout) => {
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timeout exceeded')), timeout);
    });
    return Promise.race([promise, timeoutPromise]);
};

const autoDeleteContainer = (containerId) => {
    const deleteTimeout = 14400000;
    setTimeout(async () => {
        try {
            console.log(`Scheduled deletion for container ${containerId}`);
            const container = docker.getContainer(containerId);
            await container.stop();
            await container.remove();
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

app.post('/create-container', async (req, res) => {
    try {
        console.log(`Received request to create container from ${req.ip}`);
        
        const port1 = await getAvailablePort();
        const port2 = await getAvailablePort();

        const environment = [
            'PUID=1000',
            'PGID=1000',
            'TZ=Etc/UTC',
            'CHROME_CLI=chrome://newtab',
        ];

        const volumePath = "/";
        const Dns = '94.140.14.14';

        console.log(`Creating container with image: ${CHROMIUM_IMAGE}`);
        const container = await docker.createContainer({
            Image: CHROMIUM_IMAGE,
            name: `chromium-container-${Date.now()}`,
            Tty: true,
            Env: environment,
            Volumes: {
                '/config': {}
            },
            HostConfig: {
                Binds: [`${volumePath}:/config`],
                PortBindings: {
                    '3000/tcp': [{ HostPort: `${port1}` }],
                    '3001/tcp': [{ HostPort: `${port2}` }]
                },
                shm_size: '512m',
                Dns: [Dns],
            },
            security_opt: ['seccomp:unconfined'],
        });

        await container.start();
        console.log(`Container ${container.id} started successfully`);

        const startTime = Date.now();
        db.run("INSERT INTO containers (id, start_time, port1, port2) VALUES (?, ?, ?, ?)", 
            [container.id, startTime, port1, port2], function(err) {
                if (err) {
                    console.error("Error inserting into database:", err.message);
                } else {
                    console.log(`Container ${container.id} saved to database`);
                }
            });

        autoDeleteContainer(container.id);

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

// Endpoint to manually delete a container
app.delete('/delete-container/:uuid', async (req, res) => {
    const { uuid } = req.params;
    try {
        console.log(`Received request to delete container ${uuid} from ${req.ip}`);

        db.get("SELECT * FROM containers WHERE id = ?", [uuid], async (err, row) => {
            if (err) {
                console.error("Database error:", err);
                return res.status(500).json({ error: 'Database error' });
            }
            if (!row) {
                return res.status(404).json({ error: 'Container not found' });
            }

            const container = docker.getContainer(uuid);
            await container.stop();
            await container.remove();

            db.run("DELETE FROM containers WHERE id = ?", [uuid], function(err) {
                if (err) {
                    console.error("Error deleting from database:", err.message);
                }
            });

            console.log(`Container ${sanitizer.sanitize(uuid)} stopped and removed`);
            res.status(200).json({
                message: `Container ${sanitizer.sanitize(uuid)} deleted successfully`,
            });
        });

    } catch (error) {
        console.error(`Error deleting container ${sanitizer.sanitize(uuid)}:`, error);
        res.status(500).json({ error: 'Failed to delete container' });
    }
});

// Global error handling for uncaught errors or unhandled rejections
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    process.exit(1);  // Exit the process after logging the error
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
    process.exit(1);  // Exit the process after logging the error
});

app.listen(3000, () => {
    console.log('Server is running on port 3000');
});
