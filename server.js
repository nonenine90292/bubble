require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Configuración
const PORT = process.env.PORT || 3000;
const MAP_SIZE = 14142;
const TICK_RATE = 40;

// Estado del juego
let players = {};
let pellets = [];
let bots = [];

// Color aleatorio
const COLORS = ['#FF5733', '#33FF57', '#3357FF', '#F333FF', '#FF33A1', '#33FFF5', '#FFD700', '#FF4500'];
function randomColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

// Generar pellets
function spawnPellets(count = 1000) {
  for (let i = 0; i < count; i++) {
    pellets.push({
      x: Math.random() * MAP_SIZE,
      y: Math.random() * MAP_SIZE,
      mass: 10,
      color: '#00FF00'
    });
  }
}

// Bots simples
function spawnBots(count = 10) {
  for (let i = 0; i < count; i++) {
    bots.push({
      id: `bot_${i}`,
      x: Math.random() * MAP_SIZE,
      y: Math.random() * MAP_SIZE,
      mass: Math.floor(Math.random() * 50) + 30,
      name: `Bot${i + 1}`,
      color: randomColor()
    });
  }
}

// Colisiones
function checkCollisions(player) {
  // Pellets
  for (let i = pellets.length - 1; i >= 0; i--) {
    const p = pellets[i];
    const dist = Math.hypot(player.x - p.x, player.y - p.y);
    if (dist < Math.sqrt(player.mass) + 5) {
      player.mass += 1;
      pellets.splice(i, 1);
      pellets.push({
        x: Math.random() * MAP_SIZE,
        y: Math.random() * MAP_SIZE,
        mass: 10,
        color: '#00FF00'
      });
    }
  }

  // Jugadores
  for (const id in players) {
    if (id === player.id) continue;
    const other = players[id];
    const dist = Math.hypot(player.x - other.x, player.y - other.y);
    const minDist = Math.sqrt(player.mass) + Math.sqrt(other.mass);

    if (dist < minDist) {
      if (player.mass > other.mass * 1.15) {
        player.mass += Math.floor(other.mass * 0.5);
        other.mass = Math.max(64, other.mass * 0.5);
        if (other.mass < 64) {
          other.mass = 64;
          other.x = Math.random() * MAP_SIZE;
          other.y = Math.random() * MAP_SIZE;
        }
      }
    }
  }

  // Bots
  bots.forEach(bot => {
    const dist = Math.hypot(player.x - bot.x, player.y - bot.y);
    if (dist < Math.sqrt(player.mass) + Math.sqrt(bot.mass)) {
      if (player.mass > bot.mass * 1.15) {
        player.mass += bot.mass;
        bot.mass = 64;
        bot.x = Math.random() * MAP_SIZE;
        bot.y = Math.random() * MAP_SIZE;
      }
    }
  });
}

// Leaderboard
function getLeaderboard() {
  const all = Object.values(players).map(p => ({ name: p.name, mass: p.mass }));
  all.push(...bots.map(b => ({ name: b.name, mass: b.mass })));
  return all.sort((a, b) => b.mass - a.mass).slice(0, 10);
}

// Game Loop
setInterval(() => {
  // Mover bots
  bots.forEach(bot => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + (100 / bot.mass);
    bot.x += Math.cos(angle) * speed;
    bot.y += Math.sin(angle) * speed;
    bot.x = Math.max(50, Math.min(MAP_SIZE - 50, bot.x));
    bot.y = Math.max(50, Math.min(MAP_SIZE - 50, bot.y));
  });

  // Colisiones
  Object.values(players).forEach(checkCollisions);

  // Emitir estado
  io.emit('gameState', {
    players,
    pellets,
    bots,
    leaderboard: getLeaderboard()
  });
}, 1000 / TICK_RATE);

// Socket.IO
io.on('connection', (socket) => {
  console.log('Jugador conectado:', socket.id);

  socket.on('join', (name) => {
    const playerName = (name || 'Anónimo').substring(0, 15);
    players[socket.id] = {
      id: socket.id,
      x: Math.random() * MAP_SIZE,
      y: Math.random() * MAP_SIZE,
      mass: 64,
      name: playerName,
      color: randomColor()
    };
    socket.emit('init', { id: socket.id, mapSize: MAP_SIZE });
  });

  socket.on('move', (mouseX, mouseY) => {
    const player = players[socket.id];
    if (!player) return;

    const dx = mouseX - player.x;
    const dy = mouseY - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return;

    const speed = Math.min(6 + (100 / player.mass), 12);
    player.x += (dx / dist) * speed;
    player.y += (dy / dist) * speed;

    player.x = Math.max(50, Math.min(MAP_SIZE - 50, player.x));
    player.y = Math.max(50, Math.min(MAP_SIZE - 50, player.y));
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    console.log('Jugador desconectado:', socket.id);
  });
});

// Servir archivos estáticos
app.use(express.static('public'));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar
spawnPellets(1000);
spawnBots(8);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Bubble.ao Online en puerto ${PORT}`);
});