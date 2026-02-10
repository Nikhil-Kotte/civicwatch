// CORS Middleware Setup
reports.use(async (c, next) => {
    c.header('Access-Control-Allow-Origin', 'https://your-frontend-url.com');
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return await next();
});

// Update Report Submission
if (!duplicateMaster) {
    console.log('No duplicate master found. Proceeding with new report.');
}

try {
    // Insert report into database (assuming insertion logic here)
} catch (error) {
    console.error('Database error inserting report:', error.message);
}