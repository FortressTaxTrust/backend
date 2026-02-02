import { Router } from "express";
import db from "../adapter/pgsql.js";
import { authenticateToken, adminAuth } from "../middleware/auth.js";
import { SquareClient, SquareEnvironment ,WebhooksHelper} from "square";
import { sendMail } from "../utils/mailer.js";
import PgHelper from "../utils/pgHelpers.js";
import { v4 as uuidv4 } from 'uuid';
const router = Router();

const LOCATION_ID = process.env.SQUARE_LOCATION_ID;
const TOKEN = process.env.SQUARE_TOKEN;
const SIGNATURE_KEY = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
const NOTIFICATION_URL = process.env.SQUARE_WEBHOOK_NOTIFICATION_URL ;

const squareClient = new SquareClient({
		environment: SquareEnvironment.Sandbox,
		token: TOKEN,
});

const subscriptionsApi = squareClient.subscriptions;
const customersApi = squareClient.customers;
const paymentsApi = squareClient.payments;
const cardsApi = squareClient.cards || null; 
const ordersApi = squareClient.orders;

/**
 * GET /plans
 * Get all available subscription plans. This is a public endpoint.
 */
router.get('/plans', async (req, res) => {
	try {
		const plans = await db.any(
			"SELECT id, name, price, duration_days,benefits,square_plan_id FROM subscription WHERE enabled = TRUE ORDER BY price ASC"
		);
		res.json({
			status: 'success',
			message: 'Subscription plans retrieved successfully.',
			plans: plans,
		});
	} catch (err) {
		console.error('Error fetching subscription plans:', err);
		res.status(500).json({ status: 'error', message: 'Failed to fetch subscription plans', error: err.message });
	}
});

async function ensureSquareCustomerForUser(userId) {
	const existing = await db.oneOrNone('SELECT square_customer_id FROM square_customers WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1', [userId]);
	console.log("existing" , existing)
	if (existing) return existing.square_customer_id;

	// Load user
	const user = await db.oneOrNone('SELECT id, email, first_name,last_name, phone FROM users WHERE id=$1 LIMIT 1', [userId]);
	if (!user) throw new Error('Failed to fetch User!');

	// create in Square
	const res = await customersApi.create({ emailAddress: user.email, givenName : user.first_name, familyName : user.last_name, phoneNumber: user.phone });
	const sqId = res.customer?.id;
	console.log("sqId" , res)
	if (!sqId) throw new Error('Failed to create square customer');
	await db.any(`INSERT INTO square_customers (user_id, square_customer_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,[userId, sqId]);
	return sqId;
}
router.post('/square/create-subscription', async (req, res) => {
	try {
		const { user_id, subscription_id, card_id, customer_id, no_expiry } = req.body;
		if (!user_id || !subscription_id) return res.status(400).json({ status: "error", message:'user_id & subscription_id required' });

		// Load user
		const user = await db.oneOrNone('SELECT u.id,u.email,u.first_name,sc.square_customer_id,pm.square_card_id FROM users u LEFT JOIN square_customers sc ON sc.user_id = u.id LEFT JOIN payment_methods pm  ON pm.user_id = u.id AND pm.is_default = true WHERE u.id = $1 LIMIT 1', [user_id]);
		if (!user) return res.status(404).json({ error: 'user not found' });

		console.log("user", user)
		// load subscription tier (your subscription table)
		const tier = await db.oneOrNone('SELECT * FROM subscription WHERE id=$1 LIMIT 1', [subscription_id]);
		if (!tier) return res.status(404).json({ status: "error", message: 'subscription plan not found' });

		// ensure square customer id
		let sqCustId = customer_id || user.square_customer_id;
		if (!sqCustId) sqCustId = await ensureSquareCustomerForUser(user_id);

		if (!card_id) return res.status(400).json({ status: "error", message: "card_id required" });
		if (!tier.square_plan_id) return res.status(400).json({ status: "error", message: 'subscription.square_plan_id required' });
		const orderBody = {
			idempotencyKey: uuidv4(),
			order: {
				locationId: LOCATION_ID,
				referenceId: sqCustId,
				state: 'DRAFT',
				lineItems: [
					{
						name: tier.name,
						quantity: "1",
						basePriceMoney: {
							amount: BigInt(Math.round(tier.price * 100)), // amount in cents
							currency: "USD"
						}
					}
				]
			}
		};
		console.log("orderBody" , orderBody)
		// Step 1: Create Square order
		const orderResp = await ordersApi.create(orderBody);
		const orderId = orderResp.order?.id;
		if (!orderId) throw new Error('Failed to create Square order');


		// Step 2: Create Subscription using orderId
		const data = {
            idempotencyKey: uuidv4(), // Idempotency key for safe retries
            locationId: LOCATION_ID, // Location ID from environment variable
            customerId : sqCustId, // Customer ID for the subscription
            sourceId: card_id, // Payment source ID from environment variable
            planVariationId:  tier.square_plan_id, // ID of the plan variation
            phases: [{ // Phase details of the subscription
                ordinal: BigInt(0),
                orderTemplateId: orderId
            }]
        }
		console.log("data" , data)
		const createdSubs = await subscriptionsApi.create(data);

		const createdSub = createdSubs.subscription;
		console.log("subscriptionBody" , createdSub)
		if (!createdSub) throw new Error('Square subscription creation failed');

		// Compute end date
		const chargedThrough = createdSub.chargedThroughDate ? new Date(createdSub.chargedThroughDate) : null;

		const clean = JSON.parse(JSON.stringify(createdSub, (_, v) =>
			typeof v === "bigint" ? v.toString() : v
		));
		// Step 3: Save subscription in DB
		const insert = await db.oneOrNone(
			`INSERT INTO user_subscription
			 (user_id, subscription_id, square_subscription_id, dtu, enabled, start_date, end_date, status, raw_square_payload, created_at, updated_at, no_expiry)
			 VALUES ($1,$2,$3, now(), TRUE, $4, $5, $6, $7, now(), now(), $8)
			 RETURNING *`,
			[
				user_id,
				subscription_id,
				createdSub.id,
				createdSub.startDate || new Date(),
				chargedThrough,
				'active',
				JSON.stringify(clean),
				no_expiry || false
			]
		);

		const userEmailData = {
				to: user.email,
				subject: "Your Fortress Tax and Trust Subscription is Active!",
				html: `
				<div style="font-family: Arial, sans-serif; background:#f7f7f7; padding:20px;">
				  <div style="max-width:600px; margin:auto; background:#ffffff; padding:25px; border-radius:8px; border:1px solid #e1e1e1;">
					
		  
					<h2 style="color:#333;">Welcome, ${user.first_name}!</h2>
		  
					<p>
					  Thank you for subscribing to the <strong>${tier.name}</strong> plan with Fortress Tax and Trust. 
					  Your subscription is now active and you have access to all the benefits of your plan.
					</p>

					<p><strong>Plan Details:</strong></p>
					<ul>
						<li>Plan: ${tier.name}</li>
						<li>Price: $${tier.price}</li>
						<li>Start Date: ${new Date(createdSub.startDate).toLocaleDateString()}</li>
					</ul>
		  
					<p>You can manage your subscription at any time from your account dashboard.</p>
		  
					<hr style="margin:25px 0; border:none; border-top:1px solid #ddd;">
		  
					<p style="font-size:13px; color:#666; text-align:center;">
					  Fortress Tax and Trust<br>
					  18170 Dallas Pkwy. Suite 303 Dallas, TX 75287<br>
					  <a href="https://fortresstaxandtrust.com" style="color:#4A6CF7;">fortresstaxandtrust.com</a>
					</p>
		  
				  </div>
				</div>`
			  };
			await sendMail(userEmailData);
		return res.json({ ok: true, subscription: insert });
	} catch (err) {
		console.error('create-subscription error', err);
		res.status(500).json({ status: "error", message: err.message || 'server error' });
	}
});


router.post('/square/save-card', async (req, res) => {
	try {
		const { user_id, square_customer_id, source_id ,card_information} = req.body;
		if (!source_id) return res.status(400).json({ status: "error", message: 'source_id is required' });

		let sqCustId = square_customer_id;
		if (user_id && !sqCustId) {
			sqCustId = await ensureSquareCustomerForUser(user_id)
		}
		if (!sqCustId) return res.status(400).json({ status: "error", message: 'square_customer_id or user mapping required' });
		const createBody = {
			idempotencyKey: uuidv4(),
			sourceId: source_id,
			card: { ...card_information, customerId: sqCustId ,referenceId: String(user_id),}
		};
		console.log("createBody" , createBody)

		console.log("cardsApi" ,createBody, sqCustId)
		const result = await cardsApi.create(createBody);
		const card = result.card;
		const clean = JSON.parse(JSON.stringify(card, (_, v) =>
			typeof v === "bigint" ? v.toString() : v
		));
		await db.none(
		`INSERT INTO payment_methods 
			(user_id, square_card_id, last_4, brand, exp_month, exp_year, metadata, is_default, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
			ON CONFLICT DO NOTHING`,
		[ user_id,card.id,card.last4,card.cardBrand,card.expMonth,card.expYear,JSON.stringify(clean),true]
		);
		res.json({
			status: "success",
			message: "Card Saved Successfully",
			paymentMethod: user_id,
			card : clean,
		});
	} catch (err) {
		console.error('save-card error', err?.response?.body || err);
			res.status(500).json({
			status: "error",
			message: "Failed to create payment!",
			error: err.message ,
		});
	}
});

router.post('/square/cancel-subscription', async (req, res) => {
	try {
		const { square_subscription_id, cancel_at_period_end } = req.body;
		if (!square_subscription_id) return res.status(400).json({status: "error", message: 'square_subscription_id required' });

		if (cancel_at_period_end) {
			await db.none(`UPDATE user_subscription SET cancel_at_period_end = true, updated_at = now() WHERE square_subscription_id = $1`, [square_subscription_id]);
			return res.json({ status : "successs" , message: 'Marked cancel_at_period_end in DB' });
		}

		await subscriptionsApi.cancel(square_subscription_id);
		await db.none(`UPDATE user_subscription SET status='canceled', enabled=FALSE, updated_at=now() WHERE square_subscription_id=$1`, [square_subscription_id]);
		return res.json({ status : "successs"  , message : "Subscription Cancelled!"});
	} catch (err) {
		console.error('cancel-sub error', err);
		res.status(500).json({ error: err.message || 'server error' });
	}
});


router.post('/webhook', async (req, res) => {
  try {
    const signature = req.headers['x-square-hmacsha256-signature'] || req.headers['X-Square-HmacSha256-Signature'];
    const rawBodyBuffer = req.body;
    if (!rawBodyBuffer) return res.status(400).send('no body');

    const rawBody = rawBodyBuffer.toString('utf8');
    if (!SIGNATURE_KEY || !NOTIFICATION_URL) return res.status(500).send('server misconfigured');

    const valid = await WebhooksHelper.verifySignature({requestBody: rawBody, signatureHeader: signature, signatureKey: SIGNATURE_KEY, notificationUrl: NOTIFICATION_URL});
    if (!valid) return res.status(403).send('invalid signature');

    const event = JSON.parse(rawBody);
    const eventType = event.type || event.event_type || null;

    await db.none(`INSERT INTO webhook_events (event_type, square_entity_id, payload) VALUES ($1,$2,$3)`, [eventType, event.data?.id || null, JSON.stringify(event)]);

    switch (eventType) {
      case 'subscription.created':
      case 'subscription.updated':
      case 'subscription.canceled':
      case 'subscription.paused':
      case 'subscription.resumed': {
        const sub = event.data?.object?.subscription || event.data?.object;
        if (sub?.id) {
          const status = (sub.status || '').toLowerCase();
          const chargedThrough = sub.chargedThroughDate ? new Date(sub.chargedThroughDate) : null;
          await db.none(`UPDATE user_subscription SET status=$1, end_date=COALESCE($2,end_date), raw_square_payload=$3, updated_at=now() WHERE square_subscription_id=$4`, [status, chargedThrough, JSON.stringify(sub), sub.id]);
        }
        break;
      }

      case 'payment.created':
      case 'payment.updated': {
        const payment = event.data?.object?.payment || event.data?.object;
        if (payment?.id) {
          const status = (payment.status || '').toLowerCase();
          const amount = payment.amountMoney?.amount ? payment.amountMoney.amount/100 : null;
          const currency = payment.amountMoney?.currency || null;
          const customerId = payment.customerId || null;
          const mapRes = customerId ? await db.oneOrNone(`SELECT user_id FROM square_customers WHERE square_customer_id=$1 LIMIT 1`, [customerId]) : null;
          const userId = mapRes?.user_id || null;

          await db.none(`INSERT INTO payments (user_id,square_payment_id,amount,currency,status,raw_payload,created_at) VALUES ($1,$2,$3,$4,$5,$6,now()) ON CONFLICT (square_payment_id) DO UPDATE SET status=EXCLUDED.status, raw_payload=EXCLUDED.raw_payload`, [userId, payment.id, amount, currency, status, JSON.stringify(payment)]);

          if (payment.subscriptionId) await db.none(`UPDATE user_subscription SET status=$1,last_payment_status=$2,last_payment_at=now(),updated_at=now() WHERE square_subscription_id=$3`, [status==='completed'?'active':status, status, payment.subscriptionId]);

          if ((status==='failed'|| status==='canceled') && userId) await db.none(`UPDATE user_subscription SET status='paused', last_payment_status=$1, updated_at=now() WHERE user_id=$2`, [status, userId]);
        }
        break;
      }
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('webhook processing error', err);
    res.status(500).send('server error');
  }
});

export default router;
