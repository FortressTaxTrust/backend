import { Router } from "express";
import db from "../adapter/pgsql.js";
import { authenticateToken, adminAuth } from "../middleware/auth.js";
import { SquareClient, SquareEnvironment } from "square";
import PgHelper from "../utils/pgHelpers.js";
import { v4 as uuidv4 } from 'uuid';
const router = Router();

const LOCATION_ID = process.env.SQUARE_LOCATION_ID || "L4JMPB8E5HHBY"
const TOKEN = process.env.SQUARE_TOKEN || "EAAAlyl8GiGpOaCG4CgyJCD0xhFDtGjlRA3TySBTwDT4UCSb9og4e7PjsqEZv_wO"
const SIGNATURE_KEY = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
const NOTIFICATION_URL = process.env.SQUARE_WEBHOOK_NOTIFICATION_URL;

const squareClient = new SquareClient({
		environment: SquareEnvironment.Sandbox,
		token: TOKEN,
});

const subscriptionsApi = squareClient.subscriptions;
const customersApi = squareClient.customers;
const paymentsApi = squareClient.payments;
const cardsApi = squareClient.cards || null; // may or may not be available depending on SDK version

async function ensureSquareCustomerForUser(userId) {
	const existing = await db.oneOrNone('SELECT square_customer_id FROM square_customers WHERE user_id=$1 LIMIT 1', [userId]);
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

/* ====== Endpoint: create subscription
	 Behavior:
		- Requires user_id and subscription_id (your internal subscription plan id)
		- Optionally: square_customer_id (or server will create one). Optionally: card_id (Square card on file).
		- If card_id provided => attempt to create subscription in Square and mark as active.
		- If no card_id provided => create a DB record with status 'pending' and return instructions to collect payment method.
	 Request body:
	 {
		 user_id,
		 subscription_id,      -- internal subscription.plan id (your subscription table)
		 square_customer_id,   -- optional (if not passed server will create customer if email present)
		 card_id,              -- optional square card id (if provided will create active subscription)
		 start_date,           -- optional ISO date (YYYY-MM-DD). If omitted Square uses immediate or your plan logic
		 no_expiry (boolean)   -- optional
	 }
*/
router.post('/square/create-subscription',authenticateToken, async (req, res) => {
	try {
		const { user_id, subscription_id, card_id, square_customer_id, start_date, no_expiry } = req.body;
		if (!user_id || !subscription_id) return res.status(400).json({ status: "error", message:'user_id & subscription_id required' });

		// Load user
		const user = await db.oneOrNone('SELECT u.id,u.email,u.first_name,sc.square_customer_id,pm.square_card_id FROM users u LEFT JOIN square_customers sc ON sc.user_id = u.id LEFT JOIN payment_methods pm  ON pm.user_id = u.id AND pm.is_default = true WHERE u.id = $1 LIMIT 1', [user_id]);
		if (!user) return res.status(404).json({ error: 'user not found' });

		console.log("user", user)
		// load subscription tier (your subscription table)
		const tier = await db.oneOrNone('SELECT * FROM subscription WHERE id=$1 LIMIT 1', [subscription_id]);
		if (!tier) return res.status(404).json({ status: "error", message: 'subscription plan not found' });

		// ensure square customer id
		let sqCustId = square_customer_id;
		if (!sqCustId) {
			sqCustId = await ensureSquareCustomerForUser(user_id);
		}
		if (card_id) {
			if (!tier.square_plan_id) {
				return res.status(400).json({ status: "error", message: 'Server requires subscription.square_plan_id for immediate Square subscription creation' });
			}
			const body = {
				idempotencyKey: uuidv4(),
				locationId: LOCATION_ID,
				planVariationId: tier.square_plan_id,
				customerId: sqCustId,
				startDate: start_date || undefined,
				cardId: card_id,
				canceledDate: "",
				monthlyBillingAnchorDate: 1,
				timezone: "US",
			};

			const sqResp = await subscriptionsApi.create(body);
			const createdSub = sqResp.subscription;
			if (!createdSub) throw new Error('Square subscription creation failed');

			// compute end_date from chargedThroughDate if available
			const chargedThrough = createdSub.chargedThroughDate ? new Date(createdSub.chargedThroughDate) : null;

			// Save to your user_subscription
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
					createdSub.status || 'active',
					JSON.stringify(createdSub),
					!!no_expiry
				]
			);

			return res.json({ ok: true, subscription: insert });
		}
	} catch (err) {
		console.error('create-subscription error', err);
		res.status(500).json({ status :  "error" , error: err.message || 'server error' });
	}
});


router.post('/square/save-card',authenticateToken, async (req, res) => {
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

router.post('/square/cancel-subscription',authenticateToken, async (req, res) => {
	try {
		const { square_subscription_id, cancel_at_period_end } = req.body;
		if (!square_subscription_id) return res.status(400).json({ error: 'square_subscription_id required' });

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
