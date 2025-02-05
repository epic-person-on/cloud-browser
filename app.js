const express = require('express');
const Docker = require('dockerode');
const app = express();
const docker = new Docker();
const path = require('path');

app.use(express.json());

const CHROMIUM_IMAGE = 'linuxserver/chromium:latest';

// In-memory store for container information (for deletion)
let containers = {};

// Function to get an available port (simple example, it can be improved)
const getAvailablePort = () => {
    return Math.floor(Math.random() * (65000 - 3000)) + 3000;
};

// Utility function to add timeout to any promise
const withTimeout = (promise, timeout) => {
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timeout exceeded')), timeout);
    });
    return Promise.race([promise, timeoutPromise]);
};

// Function to automatically delete containers after 4 hours (14,400,000 ms)
const autoDeleteContainer = (containerId) => {
    const deleteTimeout = 14400000; // 4 hours in milliseconds
    setTimeout(async () => {
        try {
            const container = docker.getContainer(containerId);
            await container.stop();
            await container.remove();
            delete containers[containerId];
            console.log(`Container ${containerId} deleted automatically after 4 hours`);
        } catch (error) {
            console.error(`Error deleting container ${containerId} after 4 hours:`, error);
        }
    }, deleteTimeout);
};

// Endpoint to create the container
app.post('/create-container', async (req, res) => {
    try {
        // Dynamically assign ports (3000 and 3001 for this example)
        const port1 = getAvailablePort();
        const port2 = getAvailablePort();

        // Define environment variables similar to the Compose file
        const environment = [
            'PUID=1000',
            'PGID=1000',
            'TZ=Etc/UTC',
            'CHROME_CLI=https://www.linuxserver.io/', // Optional Chrome CLI arg
        ];

        // Define volume path (Optional: can be passed in request or configured here)
        const volumePath = '/path/to/config'; // Change this to your volume path

        // Create a container from the image
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
                shm_size: '1gb',  // Shared memory size
            },
            security_opt: ['seccomp:unconfined'], // Optional security option
        });

        // Start the container
        container.start();

        // Store container data to easily reference it for deletion later
        const containerId = container.id;

        // Schedule automatic deletion after 4 hours
        autoDeleteContainer(containerId);

        // Immediately return the response with container UUID and assigned ports
        res.status(200).json({
            message: 'Container created successfully',
            uuid: containerId,
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
        // Check if the container exists in the in-memory store
        if (!containers[uuid]) {
            return res.status(404).json({ error: 'Container not found' });
        }

        const container = docker.getContainer(uuid);

        // Stop and remove the container
        await container.stop();
        await container.remove();

        // Remove from the in-memory store
        delete containers[uuid];

        res.status(200).json({
            message: `Container ${uuid} deleted successfully`,
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
