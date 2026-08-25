import swaggerJsdoc from "swagger-jsdoc";

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "PayFlow API",
      version: "1.0.0",
      description: "Payment Processing & Settlement Engine — REST API documentation",
      contact: {
        name: "B. Yochna Rao",
        email: "YochnaRao12@gmail.com",
        url: "https://github.com/yochna"
      }
    },
    servers: [
      { url: "http://localhost:5001", description: "Development" },
      { url: "https://your-render-url.onrender.com", description: "Production" }
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "JWT token for merchant dashboard routes"
        },
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "x-api-key",
          description: "API key for payment integration routes"
        }
      },
      schemas: {
        Merchant: {
          type: "object",
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
            email: { type: "string" },
            api_key: { type: "string" },
            is_active: { type: "boolean" },
            created_at: { type: "string", format: "date-time" }
          }
        },
        Payment: {
          type: "object",
          properties: {
            id: { type: "integer" },
            merchant_id: { type: "integer" },
            customer_id: { type: "integer" },
            idempotency_key: { type: "string" },
            amount: { type: "number" },
            currency: { type: "string", example: "INR" },
            status: {
              type: "string",
              enum: ["created", "processing", "captured", "failed", "refunded", "partially_refunded"]
            },
            payment_method: {
              type: "string",
              enum: ["upi", "card", "netbanking", "wallet"]
            },
            created_at: { type: "string", format: "date-time" },
            captured_at: { type: "string", format: "date-time" }
          }
        },
        Settlement: {
          type: "object",
          properties: {
            id: { type: "integer" },
            payment_id: { type: "integer" },
            gross_amount: { type: "number" },
            platform_fee: { type: "number" },
            tax_amount: { type: "number" },
            net_amount: { type: "number" },
            status: { type: "string", enum: ["pending", "processing", "settled", "failed"] }
          }
        },
        Refund: {
          type: "object",
          properties: {
            id: { type: "integer" },
            payment_id: { type: "integer" },
            amount: { type: "number" },
            reason: { type: "string" },
            status: { type: "string", enum: ["pending", "processing", "refunded", "failed"] },
            initiated_by: { type: "string", enum: ["merchant", "customer", "admin"] }
          }
        },
        Error: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            message: { type: "string" }
          }
        }
      }
    },
    paths: {
      "/api/auth/register": {
        post: {
          tags: ["Auth"],
          summary: "Register a new merchant",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name", "email", "password"],
                  properties: {
                    name: { type: "string", example: "Test Merchant" },
                    email: { type: "string", example: "merchant@test.com" },
                    password: { type: "string", example: "test123" },
                    settlement_account: { type: "string" }
                  }
                }
              }
            }
          },
          responses: {
            201: { description: "Merchant registered successfully" },
            400: { description: "Email already registered" }
          }
        }
      },
      "/api/auth/login": {
        post: {
          tags: ["Auth"],
          summary: "Login merchant",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "password"],
                  properties: {
                    email: { type: "string" },
                    password: { type: "string" }
                  }
                }
              }
            }
          },
          responses: {
            200: { description: "Login successful — returns JWT + API key" },
            404: { description: "Merchant not found" }
          }
        }
      },
      "/api/payments/create": {
        post: {
          tags: ["Payments"],
          summary: "Create a new payment",
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["amount", "payment_method"],
                  properties: {
                    amount: { type: "number", example: 1000 },
                    payment_method: { type: "string", enum: ["upi", "card", "netbanking", "wallet"] },
                    customer_name: { type: "string" },
                    customer_email: { type: "string" },
                    customer_phone: { type: "string" },
                    idempotency_key: { type: "string", description: "Unique key to prevent duplicate payments" }
                  }
                }
              }
            }
          },
          responses: {
            201: { description: "Payment created" },
            200: { description: "Idempotent response — payment already exists" },
            400: { description: "Validation error" }
          }
        }
      },
      "/api/payments/capture/{id}": {
        post: {
          tags: ["Payments"],
          summary: "Capture a payment + auto-settle",
          security: [{ ApiKeyAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: {
            200: { description: "Payment captured and settlement initiated" },
            404: { description: "Payment not found" }
          }
        }
      },
      "/api/payments": {
        get: {
          tags: ["Payments"],
          summary: "Get all payments (paginated)",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 10 } },
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "payment_method", in: "query", schema: { type: "string" } }
          ],
          responses: { 200: { description: "List of payments with pagination" } }
        }
      },
      "/api/refunds": {
        post: {
          tags: ["Refunds"],
          summary: "Initiate a refund (full or partial)",
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["payment_id", "amount"],
                  properties: {
                    payment_id: { type: "integer" },
                    amount: { type: "number" },
                    reason: { type: "string" },
                    initiated_by: { type: "string", enum: ["merchant", "customer", "admin"] }
                  }
                }
              }
            }
          },
          responses: {
            201: { description: "Refund processed" },
            400: { description: "Invalid refund amount or payment status" }
          }
        }
      },
      "/api/settlements/summary": {
        get: {
          tags: ["Settlements"],
          summary: "Get settlement summary with daily breakdown",
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: "Settlement summary with overall stats and daily breakdown" } }
        }
      },
      "/api/analytics/summary": {
        get: {
          tags: ["Analytics"],
          summary: "Dashboard summary — today + this month + pending settlements",
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: "Analytics summary" } }
        }
      },
      "/api/analytics/success-rate": {
        get: {
          tags: ["Analytics"],
          summary: "Payment success rate",
          security: [{ BearerAuth: [] }],
          parameters: [{ name: "days", in: "query", schema: { type: "integer", default: 30 } }],
          responses: { 200: { description: "Success rate stats" } }
        }
      },
      "/api/analytics/volume": {
        get: {
          tags: ["Analytics"],
          summary: "Payment volume by day/week/month",
          security: [{ BearerAuth: [] }],
          parameters: [{ name: "group_by", in: "query", schema: { type: "string", enum: ["day", "week", "month"] } }],
          responses: { 200: { description: "Volume data" } }
        }
      }
    }
  },
  apis: []
};

export const swaggerSpec = swaggerJsdoc(options);