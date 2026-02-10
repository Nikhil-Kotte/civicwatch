import express from 'express';
import axios from 'axios';

const router = express.Router();

// Update the endpoint URL
const endpointUrl = 'https://civicwatch-backend-p7or.onrender.com/classify';

router.post('/classify', async (req, res) => {
    try {
        const response = await axios.post(endpointUrl, req.body);
        res.status(200).json(response.data);
    } catch (error) {
        console.error('Error occurred while classifying:', error.message); // Log the error message
        res.status(500).json({ message: 'An error occurred while processing your request.', error: error.message });
    }
});

export default router;