const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const connectDB = require('./config/db');
const analyticsRoutes = require('./routes/nalyticsRoutes');
const returnRoutes = require('./routes/returnRoutes');
const helperRoutes = require('./routes/helperRoutes');

// Config
dotenv.config();
connectDB();

const app = express();
const server = http.createServer(app);

// Real-Time Engine (Socket.io)
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000"], // Frontend URL
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Inject Socket.io into every Request
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Test Route
app.get('/', (req, res) => {
  res.send('🏭 Factory ERP API is Running...');
});
app.use('/api/analytics', analyticsRoutes);
// --- API ROUTES ---
app.use('/api/dashboard/stats', require('./controllers/dashboardController').getStats);

// 🟢 NEW: Helper Routes for Kitting Dropdowns (Materials & Vendors)
// We mount these BEFORE the main routes to ensure they are checked first
app.use('/api/inventory', helperRoutes);   // Serves /api/inventory/materials
app.use('/api/procurement', helperRoutes); // Serves /api/procurement/vendors
app.use('/api/returns', returnRoutes);
app.use('/api/surplus', require('./routes/surplusRoutes'));

// Commercial Routes
app.use('/api/products', require('./routes/productRoutes'));
app.use('/api/sales', require('./routes/salesRoutes')); // 🟢 Handles /quotes, /orders, /clients, /leads
app.use('/api/procurement', require('./routes/procurementRoutes'));
app.use('/api/vendors', require('./routes/vendorRoutes'));

// Factory Floor Routes
app.use('/api/production', require('./routes/productionRoutes'));
app.use('/api/inventory', require('./routes/inventoryRoutes'));

// 🚨 CRITICAL: Shop Floor & Job Card Route
app.use('/api/shopfloor', require('./routes/jobRoutes')); 

app.use('/api/sampling', require('./routes/samplingRoutes'));
app.use('/api/quality', require('./routes/qualityRoutes'));
app.use('/api/finance', require('./routes/financeRoutes'));
app.use('/api/reports', require('./routes/reportRoutes'));
app.use('/api/auth', require('./routes/authRoutes'));

// 🔴 REMOVED: quotationRoutes (Merged into salesRoutes)
// app.use('/api/sales/quotes', require('./routes/quotationRoutes')); <--- This was causing the crash

app.use('/api/sales/expenses', require('./routes/expenseRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/master', require('./routes/masterRoutes'));
app.use('/api/roles', require('./routes/roleRoutes'));
app.use('/api/logistics', require('./routes/logisticsRoutes'));
app.use('/api/helpers', helperRoutes);


// Socket Events
io.on('connection', (socket) => {
  console.log('🔌 Client Connected:', socket.id);
  socket.on('disconnect', () => console.log('🔌 Client Disconnected'));
});

// Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));