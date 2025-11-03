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
  // Worker: Setup del servidor
  const app = express();
  const server = http.createServer(app);
  const io = socketIo(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingInterval: 10000,
    pingTimeout: 5000,
    maxHttpBufferSize: 1e6, // Límite para payloads grandes (imágenes)
  });

  // Middleware optimizado
  app.use(compression());
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.static(path.join(__dirname, 'public'))); // Sirve el HTML/cliente

  // Rate limiting para endpoints HTTP (opcional, para APIs)
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 100, // 100 req por IP
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/', limiter);

  // Simulación de servidores (datos mock, en prod: lee de DB)
  const servers = [
    { id: 1, name: 'EU #1', map: 'Procedimental', playersCur: 45, playersMax: 70, state: 'online', ping: 45, tags: ['PVE', 'PREMIUM'], flags: { A_DIARIO: true, PREMIUM: true }, desc: 'Servidor premium diario.' },
    { id: 2, name: 'EU #2', map: 'Custom', playersCur: 23, playersMax: 70, state: 'online', ping: 78, tags: ['PVP'], flags: { SEMANAL: true }, desc: 'PvP semanal.' },
    { id: 3, name: 'EU #3', map: 'Procedimental', playersCur: 67, playersMax: 70, state: 'downloading', ping: 32, tags: ['PVE_ONLY'], flags: { MENSUAL: true }, desc: 'PVE mensual.' },
    // Agrega más...
  ];

  // Estado global por servidor (en prod: usa Redis para escalabilidad)
  const serverStates = {};
  servers.forEach(s => {
    serverStates[s.id] = {
      players: {}, // {socketId: playerData}
      bots: {},    // {id: botData}
      miniBots: {}, // {id: miniBotData}
      foods: {},   // {id: foodData}
      playerCounts: {}, // Actualizaciones de counts
    };
  });

  // Generador de bots y foods (simulado)
  function generateBotsAndFoods(serverId, numBots = 20, numFoods = 100, numMini = 10) {
    const state = serverStates[serverId];
    // Bots
    for (let i = 0; i < numBots; i++) {
      state.bots[`bot${i}`] = {
        id: `bot${i}`,
        name: `Bot-${i}`,
        x: Math.random() * 4000,
        y: Math.random() * 4000,
        radius: 20 + Math.random() * 30,
        color: `hsl(${Math.random() * 360}, 70%, 55%)`,
      };
    }
    // Mini bots
    for (let i = 0; i < numMini; i++) {
      state.miniBots[`mini${i}`] = {
        id: `mini${i}`,
        name: `Mini-${i}`,
        x: Math.random() * 4000,
        y: Math.random() * 4000,
        radius: 10 + Math.random() * 10,
        color: `hsl(${Math.random() * 360}, 70%, 55%)`,
      };
    }
    // Foods
    for (let i = 0; i < numFoods; i++) {
      state.foods[`food${i}`] = {
        id: `food${i}`,
        x: Math.random() * 4000,
        y: Math.random() * 4000,
        radius: 5,
        color: `hsl(${Math.random() * 360}, 70%, 55%)`,
      };
    }
  }
  servers.forEach(s => generateBotsAndFoods(s.id));

  // Socket events
  io.on('connection', (socket) => {
    console.log(`Cliente conectado: ${socket.id}`);

    // Envía lista de servidores
    socket.on('getServers', () => {
      socket.emit('servers', servers);
    });

    // Únete a un servidor
    socket.on('joinServer', ({ serverId, playerData }) => {
      if (!serverStates[serverId]) return socket.disconnect();
      const state = serverStates[serverId];
      state.players[socket.id] = { ...playerData, id: socket.id, x: Math.random() * 4000, y: Math.random() * 4000 };
      socket.currentServerId = serverId;  // Fix: Track per socket
      socket.join(`server_${serverId}`); // Room para broadcasts
      socket.emit('state', state); // Envía estado inicial
      socket.emit('joinAck', serverId);  // Nuevo: Ack para cliente
      io.to(`server_${serverId}`).emit('playerCountUpdate', { [serverId]: Object.keys(state.players).length });
    });

    // Movimiento del jugador
    socket.on('move', (dir) => {
      const currentServerId = socket.currentServerId;
      if (!currentServerId) return;
      const player = serverStates[currentServerId]?.players[socket.id]; // Fix: Usa tracked ID
      if (player) {
        player.x += dir.x * player.speed;
        player.y += dir.y * player.speed;
        // Wrap around world
        if (player.x < 0) player.x += 4000;
        if (player.x > 4000) player.x -= 4000;
        if (player.y < 0) player.y += 4000;
        if (player.y > 4000) player.y -= 4000;
      }
    });

    // Chat
    socket.on('chat', (text) => {
      const currentServerId = socket.currentServerId;
      if (!currentServerId) return;
      io.to(`server_${currentServerId}`).emit('chat', { sender: player.name, text });  // Fix: player.name from tracked
    });

    // Actualiza jugador (skins, points, etc.)
    socket.on('updatePlayer', (updates) => {
      const currentServerId = socket.currentServerId;
      if (!currentServerId) return;
      const player = serverStates[currentServerId]?.players[socket.id];
      if (player) {
        Object.assign(player, updates);
        // Broadcast update a room
        socket.to(`server_${currentServerId}`).emit('playerUpdate', { id: socket.id, ...updates });
      }
    });

    // Simula updates de estado cada 50ms (optimizado: solo delta changes en prod)
    const interval = setInterval(() => {
      const currentServerId = socket.currentServerId;
      if (currentServerId) {
        // Simula movimiento de bots/foods (en prod: physics engine)
        Object.values(serverStates[currentServerId].bots).forEach(bot => {
          bot.x += (Math.random() - 0.5) * 2;
          bot.y += (Math.random() - 0.5) * 2;
        });
        socket.emit('state', serverStates[currentServerId]);
      }
    }, 50);

    socket.on('disconnect', () => {
      // Limpia jugador
      const currentServerId = socket.currentServerId;
      if (currentServerId) {
        delete serverStates[currentServerId].players[socket.id];
        io.to(`server_${currentServerId}`).emit('playerCountUpdate', { [currentServerId]: Object.keys(serverStates[currentServerId].players).length });
      }
      clearInterval(interval);
      console.log(`Cliente desconectado: ${socket.id}`);
    });
  });

  // Ruta para servir el cliente HTML
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html')); // Asume HTML en /public
  });

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Worker ${process.pid} escuchando en puerto ${PORT}`);
  });
             }
