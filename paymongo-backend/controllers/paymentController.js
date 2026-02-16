// controllers/paymentController.js
const paymongoService = require('../services/paymongoService');
const webhookService = require('../services/webhookService');
const { generateId, validateEmail, validateMobile } = require('../utils/helpers');

// Product pricing mapping
const PRODUCTS = {
    'START UP VA Course': { amount: 1500, currency: 'PHP' },
    'GHL Practice Access': { amount: 500, currency: 'PHP' },
    'Freelancer Plan': { amount: 3500, currency: 'PHP' },
    'Dedicated Coaching': { amount: 999, currency: 'PHP' },
    'Customization Plan': { amount: 5000, currency: 'PHP' },
    'Client Finder Tool': { amount: 500, currency: 'PHP' }
};

// Create payment intent
exports.createPaymentIntent = async (req, res) => {
    try {
        // ✅ FIXED: Added paymentMethod and source to destructuring
        const {
            fullName,
            email,
            mobile,
            product,
            notes,
            businessName,
            setupType,
            timezone,
            experienceLevel,
            coachingGoals,
            targetClient,
            paymentMethod, // ✅ ADD THIS - was missing!
            source,        // ✅ ADD THIS - was missing!
            metadata = {}
        } = req.body;

        // Validate required fields
        if (!fullName || !email || !mobile || !product) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['fullName', 'email', 'mobile', 'product']
            });
        }

        // Validate email
        if (!validateEmail(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        // Validate mobile
        if (!validateMobile(mobile)) {
            return res.status(400).json({ error: 'Invalid mobile number format' });
        }

        // Get product amount
        const productInfo = PRODUCTS[product];
        if (!productInfo) {
            return res.status(400).json({ error: 'Invalid product' });
        }

        // Generate unique payment reference
        const paymentReference = generateId('PAY');

        // Log what we received for debugging
        console.log('Received payment request:', {
            fullName,
            email,
            mobile,
            product,
            paymentMethod,
            source
        });

        // ✅ FIXED: Flatten metadata - include paymentMethod and source
        const flattenedMetadata = {
            // Required fields
            fullName: String(fullName || ''),
            email: String(email || ''),
            mobile: String(mobile || ''),
            product: String(product || ''),
            paymentReference: String(paymentReference || ''),

            // Optional fields
            notes: String(notes || ''),
            businessName: String(businessName || ''),
            setupType: String(setupType || ''),
            timezone: String(timezone || ''),
            experienceLevel: String(experienceLevel || ''),
            coachingGoals: String(coachingGoals || ''),
            targetClient: String(targetClient || ''),

            // ✅ ADDED: These were missing!
            paymentMethod: String(paymentMethod || 'gcash'),
            source: String(source || 'nexistry_academy'),

            // Timestamp
            timestamp: new Date().toISOString()
        };

        // Remove any empty values that PayMongo might reject
        Object.keys(flattenedMetadata).forEach(key => {
            if (flattenedMetadata[key] === '' || flattenedMetadata[key] === 'undefined' || flattenedMetadata[key] === 'null') {
                delete flattenedMetadata[key];
            }
        });

        // Log the metadata being sent to PayMongo
        console.log('Sending to PayMongo with metadata:', flattenedMetadata);

        // Create PayMongo payment intent with flattened metadata
        const paymentIntent = await paymongoService.createPaymentIntent({
            amount: productInfo.amount,
            currency: productInfo.currency,
            description: `${product} - ${fullName}`,
            paymentMethodAllowed: ['gcash', 'paymaya', 'card'],
            metadata: flattenedMetadata
        });

        console.log('Payment intent created:', paymentIntent.id);

        // Send to LeadConnector webhook - include paymentMethod and source
        await webhookService.sendToLeadConnector({
            fullName,
            email,
            mobile,
            product,
            amount: productInfo.amount,
            currency: productInfo.currency,
            paymentReference,
            notes,
            businessName,
            setupType,
            timezone,
            experienceLevel,
            coachingGoals,
            targetClient,
            paymentMethod, // ✅ Now included
            source,        // ✅ Now included
            status: 'payment_initiated',
            paymentIntentId: paymentIntent.id,
            checkoutUrl: paymentIntent.attributes.checkout_url,
            timestamp: new Date().toISOString()
        }).catch(err => console.log('LeadConnector webhook error:', err.message));

        // Return payment details to frontend
        res.status(200).json({
            success: true,
            paymentIntentId: paymentIntent.id,
            clientSecret: paymentIntent.attributes.client_secret,
            checkoutUrl: paymentIntent.attributes.checkout_url,
            paymentReference,
            amount: productInfo.amount,
            currency: productInfo.currency
        });

    } catch (error) {
        console.error('Payment intent creation error:', error);
        res.status(500).json({
            error: 'Failed to create payment intent',
            message: error.message
        });
    }
};

// Get payment status
exports.getPaymentStatus = async (req, res) => {
    try {
        const { paymentId } = req.params;

        if (!paymentId) {
            return res.status(400).json({ error: 'Payment ID required' });
        }

        const paymentStatus = await paymongoService.getPaymentIntent(paymentId);

        res.status(200).json({
            success: true,
            status: paymentStatus.attributes.status,
            paid: paymentStatus.attributes.status === 'succeeded',
            paymentIntent: paymentStatus
        });

    } catch (error) {
        console.error('Payment status check error:', error);
        res.status(500).json({
            error: 'Failed to get payment status',
            message: error.message
        });
    }
};

// Handle PayMongo webhook
exports.handleWebhook = async (req, res) => {
    try {
        const event = req.body;

        console.log('Webhook received:', event.data.type);
        console.log('Event data:', JSON.stringify(event.data, null, 2));

        // Handle different event types
        switch (event.data.type) {
            case 'payment.paid':
                await handlePaymentSuccess(event.data.attributes);
                break;

            case 'payment.failed':
                await handlePaymentFailure(event.data.attributes);
                break;

            case 'payment.pending':
                await handlePaymentPending(event.data.attributes);
                break;

            default:
                console.log('Unhandled event type:', event.data.type);
        }

        // Always return 200 to acknowledge receipt
        res.status(200).json({ received: true });

    } catch (error) {
        console.error('Webhook processing error:', error);
        // Still return 200 to prevent PayMongo from retrying
        res.status(200).json({ received: true, error: error.message });
    }
};

// Cancel payment
exports.cancelPayment = async (req, res) => {
    try {
        const { paymentId } = req.params;
        const reason = req.body.reason || 'User cancelled';

        if (!paymentId) {
            return res.status(400).json({ error: 'Payment ID required' });
        }

        res.status(200).json({
            success: true,
            message: 'Payment cancelled',
            paymentId
        });

    } catch (error) {
        console.error('Payment cancellation error:', error);
        res.status(500).json({ error: 'Failed to cancel payment' });
    }
};

// Retry payment
exports.retryPayment = async (req, res) => {
    try {
        const { paymentId } = req.params;

        if (!paymentId) {
            return res.status(400).json({ error: 'Payment ID required' });
        }

        const paymentIntent = await paymongoService.getPaymentIntent(paymentId);

        res.status(200).json({
            success: true,
            checkoutUrl: paymentIntent.attributes.checkout_url,
            paymentIntentId: paymentIntent.id
        });

    } catch (error) {
        console.error('Payment retry error:', error);
        res.status(500).json({ error: 'Failed to retry payment' });
    }
};

// Get payment methods
exports.getPaymentMethods = (req, res) => {
    res.status(200).json({
        methods: [
            { id: 'gcash', name: 'GCash', icon: 'gcash-icon.png' },
            { id: 'paymaya', name: 'PayMaya', icon: 'paymaya-icon.png' },
            { id: 'card', name: 'Credit/Debit Card', icon: 'card-icon.png' },
            { id: 'grab_pay', name: 'GrabPay', icon: 'grab-icon.png' }
        ]
    });
};

// Validate payment details
exports.validatePayment = (req, res) => {
    const { fullName, email, mobile, amount } = req.body;
    const errors = [];

    if (!fullName || fullName.length < 2) {
        errors.push('Full name must be at least 2 characters');
    }

    if (!email || !validateEmail(email)) {
        errors.push('Valid email is required');
    }

    if (!mobile || !validateMobile(mobile)) {
        errors.push('Valid mobile number is required');
    }

    if (amount && (isNaN(amount) || amount < 1)) {
        errors.push('Invalid amount');
    }

    if (errors.length > 0) {
        return res.status(400).json({ valid: false, errors });
    }

    res.status(200).json({ valid: true });
};

// Helper functions for webhook handling
async function handlePaymentSuccess(attributes) {
    console.log('Payment succeeded:', attributes);

    const paymentData = attributes.data || {};
    const metadata = paymentData.attributes?.metadata || {};

    await webhookService.sendToLeadConnector({
        ...metadata,
        status: 'payment_successful',
        paymentId: paymentData.id,
        paymentDetails: attributes,
        completedAt: new Date().toISOString()
    }).catch(err => console.log('LeadConnector webhook error:', err));
}

async function handlePaymentFailure(attributes) {
    console.log('Payment failed:', attributes);

    const paymentData = attributes.data || {};
    const metadata = paymentData.attributes?.metadata || {};

    await webhookService.sendToLeadConnector({
        ...metadata,
        status: 'payment_failed',
        paymentId: paymentData.id,
        failureReason: attributes.attributes?.source?.message || 'Unknown error',
        failedAt: new Date().toISOString()
    }).catch(err => console.log('LeadConnector webhook error:', err));
}

async function handlePaymentPending(attributes) {
    console.log('Payment pending:', attributes);
}