// server.js
require('dotenv').config();
const cluster = require('cluster');
const os = require('os');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const compression = require('compression');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const numCPUs = os.cpus().length;

if (cluster.isMaster) {
  console.log(`Master ${process.pid} iniciado. Forking ${numCPUs} workers...`);
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
  cluster.on('exit', (worker) => {
    console.log(`Worker ${worker.process.pid} murió. Reiniciando...`);
    cluster.fork();
  });
} else {
  // --- Worker: Servidor principal ---
  const app = express();
  const server = http.createServer(app);
  const io = socketIo(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingInterval: 10000,
    pingTimeout: 5000,
    maxHttpBufferSize: 1e6,
  });

  // --- Middlewares ---
  app.use(compression());
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  // --- Rate Limiter (opcional para API REST) ---
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/', limiter);

  // --- Servidores simulados ---
  const servers = [
    { id: 1, name: 'EU #1', map: 'Procedimental', playersCur: 45, playersMax: 70, state: 'online', ping: 45, tags: ['PVE', 'PREMIUM'], flags: { A_DIARIO: true, PREMIUM: true }, desc: 'Servidor premium diario.' },
    { id: 2, name: 'EU #2', map: 'Custom', playersCur: 23, playersMax: 70, state: 'online', ping: 78, tags: ['PVP'], flags: { SEMANAL: true }, desc: 'PvP semanal.' },
    { id: 3, name: 'EU #3', map: 'Procedimental', playersCur: 67, playersMax: 70, state: 'downloading', ping: 32, tags: ['PVE_ONLY'], flags: { MENSUAL: true }, desc: 'PVE mensual.' },
  ];

  // --- Estado global (solo jugadores, sin bots/foods) ---
  const serverStates = {};
  servers.forEach(s => {
    serverStates[s.id] = {
      players: {},
    };
  });

  // --- SOCKET.IO ---
  io.on('connection', (socket) => {
    console.log(`Cliente conectado: ${socket.id}`);

    let currentServerId = null;
    let interval = null;

    // Envía lista de servidores
    socket.on('getServers', () => {
      socket.emit('servers', servers);
    });

    // Unirse a un servidor
    socket.on('joinServer', ({ serverId, playerData }) => {
      if (!serverStates[serverId]) return socket.disconnect();

      currentServerId = serverId;
      const state = serverStates[serverId];
      state.players[socket.id] = {
        ...playerData,
        id: socket.id,
        x: Math.random() * 4000,
        y: Math.random() * 4000,
        speed: 5
      };

      socket.join(`server_${serverId}`);
      socket.emit('state', state);  // Solo jugadores
      io.to(`server_${serverId}`).emit('playerCountUpdate', {
        [serverId]: Object.keys(state.players).length
      });

      // Simulación continua (solo para jugadores, sin bots)
      interval = setInterval(() => {
        if (currentServerId) {
          socket.emit('state', serverStates[currentServerId]);  // Solo jugadores
        }
      }, 50);
    });

    // Movimiento
    socket.on('move', (dir) => {
      if (!currentServerId) return;
      const player = serverStates[currentServerId]?.players[socket.id];
      if (player) {
        player.x += dir.x * player.speed;
        player.y += dir.y * player.speed;
        if (player.x < 0) player.x += 4000;
        if (player.x > 4000) player.x -= 4000;
        if (player.y < 0) player.y += 4000;
        if (player.y > 4000) player.y -= 4000;
      }
    });

    // Chat
    socket.on('chat', (text) => {
      if (!currentServerId) return;
      const player = serverStates[currentServerId]?.players[socket.id];
      if (player) {
        io.to(`server_${currentServerId}`).emit('chat', {
          sender: player.name,
          text
        });
      }
    });

    // Actualiza jugador
    socket.on('updatePlayer', (updates) => {
      if (!currentServerId) return;
      const player = serverStates[currentServerId]?.players[socket.id];
      if (player) {
        Object.assign(player, updates);
        socket.to(`server_${currentServerId}`).emit('playerUpdate', {
          id: socket.id,
          ...updates
        });
      }
    });

    // Desconexión
    socket.on('disconnect', () => {
      if (currentServerId) {
        delete serverStates[currentServerId].players[socket.id];
        io.to(`server_${currentServerId}`).emit('playerCountUpdate', {
          [currentServerId]: Object.keys(serverStates[currentServerId].players).length
        });
      }
      if (interval) clearInterval(interval);
      console.log(`Cliente desconectado: ${socket.id}`);
    });
  });

  // --- Servir cliente HTML ---
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Worker ${process.pid} escuchando en puerto ${PORT}`);
  });
                            }
