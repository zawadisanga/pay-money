function errorHandler(err, req, res, next) {
  console.error('Error:', err);
  
  // Default error
  const status = err.status || 500;
  const message = err.message || 'Internal server error';
  
  res.status(status).json({
    success: false,
    error: message,
    timestamp: new Date().toISOString()
  });
}

module.exports = { errorHandler };
