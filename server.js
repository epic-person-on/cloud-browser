require('dotenv').config();
const express = require('express');
const Docker = require('dockerode');
const { v4: uuidv4 } = require('uuid');

const app = express();
const docker = new Docker({ socketPath: process.env.DOCKER_HOST || '/var/run/docker.sock' });

const PORT = 3000;
const AUTH_SECRET = process.env.AUTH_SECRET; // Use secret for auth validation
const DEV_MODE = process.env.DEV_MODE === 'true'; // Flag to check if we are in dev mode

// Store container information
let containers = {};

app.use(express.json());

// Middleware to check authorization header
function checkAuth(req, res, next) {
  if (DEV_MODE) {
    // In development mode, bypass the authorization check
    return next();
  }

  const authHeader = req.header('Authorization');
  if (authHeader && authHeader === `Bearer ${AUTH_SECRET}`) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

// Route to create a Chromium container
app.post('/create-container', checkAuth, async (req, res) => {
  try {
    const containerName = `chromium-container-${uuidv4()}`;

    // Run Chromium container using the linuxserver.io image
    const container = await docker.createContainer({
      Image: 'linuxserver/chromium', 
      name: containerName,
      ExposedPorts: { '9222/tcp': {} }, // Expose port for remote debugging
      HostConfig: {
        PortBindings: {
          '9222/tcp': [
            {
              HostPort: '0', // Let Docker auto-assign an available port
            },
          ],
        },
      },
    });

    // Start the container
    await container.start();

    // Get the assigned port
    const portBindings = container.attrs.HostConfig.PortBindings['9222/tcp'];
    const assignedPort = portBindings ? portBindings[0].HostPort : null;

    // Store container info
    containers[container.id] = {
      id: container.id,
      hostname: 'localhost',
      port: assignedPort,
    };

    // Return the container ID, hostname, and port
    res.json({
      id: container.id,
      hostname: 'localhost',
      port: assignedPort,
    });
  } catch (error) {
    console.error('Error creating container:', error);
    res.status(500).json({ error: 'Failed to create container' });
  }
});

// Route to list active containers
app.get('/containers', checkAuth, (req, res) => {
  const containerList = Object.values(containers);
  res.json(containerList);
});

// Route to delete a container
app.delete('/delete-container/:id', checkAuth, async (req, res) => {
  const { id } = req.params;

  if (!containers[id]) {
    return res.status(404).json({ error: 'Container not found' });
  }

  try {
    const container = docker.getContainer(id);
    
    // Stop the container if it's running
    await container.stop();
    
    // Remove the container
    await container.remove();

    // Delete the container from the in-memory store
    delete containers[id];

    res.json({ message: `Container ${id} has been deleted successfully` });
  } catch (error) {
    console.error('Error deleting container:', error);
    res.status(500).json({ error: 'Failed to delete container' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
