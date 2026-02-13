// services/paymongoService.js
const axios = require('axios');

class PayMongoService {
    constructor() {
        this.baseURL = 'https://api.paymongo.com/v1';
        this.secretKey = process.env.PAYMONGO_SECRET_KEY;

        this.client = axios.create({
            baseURL: this.baseURL,
            headers: {
                'Authorization': `Basic ${Buffer.from(this.secretKey + ':').toString('base64')}`,
                'Content-Type': 'application/json'
            }
        });
    }

    // Create a payment intent
    async createPaymentIntent({ amount, currency, description, paymentMethodAllowed, metadata }) {
        try {
            const response = await this.client.post('/payment_intents', {
                data: {
                    attributes: {
                        amount: amount * 100, // Convert to cents/centavos
                        currency: currency,
                        description,
                        statement_descriptor: 'Nexistry Academy',
                        payment_method_allowed: paymentMethodAllowed || ['gcash', 'card'],
                        metadata: {
                            ...metadata,
                            source: 'nexistry_academy'
                        }
                    }
                }
            });

            // Create checkout URL for the payment intent
            const checkoutResponse = await this.createCheckoutSession(response.data.data.id, {
                amount,
                currency,
                description,
                metadata
            });

            return {
                ...response.data.data,
                attributes: {
                    ...response.data.data.attributes,
                    checkout_url: checkoutResponse.data.data.attributes.checkout_url
                }
            };

        } catch (error) {
            console.error('PayMongo create payment intent error:', error.response?.data || error.message);
            throw new Error(error.response?.data?.errors?.[0]?.detail || 'Failed to create payment intent');
        }
    }

    // Create a checkout session
    async createCheckoutSession(paymentIntentId, { amount, currency, description, metadata }) {
        try {
            const response = await this.client.post('/checkout_sessions', {
                data: {
                    attributes: {
                        send_email_receipt: true,
                        show_description: true,
                        show_line_items: true,
                        line_items: [
                            {
                                amount: amount * 100,
                                currency: currency.toLowerCase(),
                                description,
                                name: description,
                                quantity: 1
                            }
                        ],
                        payment_method_types: ['gcash', 'card', 'paymaya'],
                        description,
                        metadata,
                        success_url: `${process.env.FRONTEND_SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
                        failure_url: process.env.FRONTEND_FAILURE_URL,
                        cancel_url: process.env.FRONTEND_CANCEL_URL
                    }
                }
            });

            return response.data;
        } catch (error) {
            console.error('PayMongo create checkout error:', error.response?.data || error.message);
            throw new Error('Failed to create checkout session');
        }
    }

    // Get payment intent details
    async getPaymentIntent(paymentIntentId) {
        try {
            const response = await this.client.get(`/payment_intents/${paymentIntentId}`);
            return response.data.data;
        } catch (error) {
            console.error('PayMongo get payment intent error:', error.response?.data || error.message);
            throw new Error('Failed to retrieve payment intent');
        }
    }

    // Attach payment method to intent (for card payments)
    async attachPaymentMethod(paymentIntentId, paymentMethodId) {
        try {
            const response = await this.client.post('/payment_intents/attach', {
                data: {
                    attributes: {
                        payment_intent_id: paymentIntentId,
                        payment_method_id: paymentMethodId
                    }
                }
            });
            return response.data;
        } catch (error) {
            console.error('PayMongo attach payment method error:', error.response?.data || error.message);
            throw new Error('Failed to attach payment method');
        }
    }

    // Create payment method (for saved cards)
    async createPaymentMethod({ type, details }) {
        try {
            const response = await this.client.post('/payment_methods', {
                data: {
                    attributes: {
                        type,
                        details
                    }
                }
            });
            return response.data;
        } catch (error) {
            console.error('PayMongo create payment method error:', error.response?.data || error.message);
            throw new Error('Failed to create payment method');
        }
    }

    // List all payments
    async listPayments(limit = 10) {
        try {
            const response = await this.client.get('/payments', {
                params: { limit }
            });
            return response.data.data;
        } catch (error) {
            console.error('PayMongo list payments error:', error.response?.data || error.message);
            throw new Error('Failed to list payments');
        }
    }

    // Get payment by ID
    async getPayment(paymentId) {
        try {
            const response = await this.client.get(`/payments/${paymentId}`);
            return response.data.data;
        } catch (error) {
            console.error('PayMongo get payment error:', error.response?.data || error.message);
            throw new Error('Failed to retrieve payment');
        }
    }

    // Refund payment
    async refundPayment(paymentId, amount, reason = 'requested_by_customer') {
        try {
            const response = await this.client.post('/refunds', {
                data: {
                    attributes: {
                        payment_id: paymentId,
                        amount: amount * 100,
                        reason
                    }
                }
            });
            return response.data;
        } catch (error) {
            console.error('PayMongo refund error:', error.response?.data || error.message);
            throw new Error('Failed to process refund');
        }
    }

    // Expire checkout session
    async expireCheckoutSession(sessionId) {
        try {
            const response = await this.client.post(`/checkout_sessions/${sessionId}/expire`);
            return response.data;
        } catch (error) {
            console.error('PayMongo expire session error:', error.response?.data || error.message);
            throw new Error('Failed to expire checkout session');
        }
    }

    // Get checkout session details
    async getCheckoutSession(sessionId) {
        try {
            const response = await this.client.get(`/checkout_sessions/${sessionId}`);
            return response.data.data;
        } catch (error) {
            console.error('PayMongo get checkout session error:', error.response?.data || error.message);
            throw new Error('Failed to retrieve checkout session');
        }
    }

    // List webhooks
    async listWebhooks() {
        try {
            const response = await this.client.get('/webhooks');
            return response.data.data;
        } catch (error) {
            console.error('PayMongo list webhooks error:', error.response?.data || error.message);
            throw new Error('Failed to list webhooks');
        }
    }

    // Create webhook (for initial setup)
    async createWebhook(url, events = ['payment.paid', 'payment.failed']) {
        try {
            const response = await this.client.post('/webhooks', {
                data: {
                    attributes: {
                        url,
                        events
                    }
                }
            });
            return response.data;
        } catch (error) {
            console.error('PayMongo create webhook error:', error.response?.data || error.message);
            throw new Error('Failed to create webhook');
        }
    }
}

module.exports = new PayMongoService();