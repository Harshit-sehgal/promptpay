import { Controller, Post, Req, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { Request } from 'express';
import Stripe from 'stripe';
import { getErrorMessage } from '../utils/errors';
import { StripeProvider } from '../../payout/providers';
import { PrismaService } from '../../config/prisma.service';

type RawBodyRequest = Request & { rawBody?: Buffer | string };

/**
 * Webhook controller for receiving Stripe events.
 *
 * This controller is intentionally NOT guarded by JWT — Stripe sends
 * webhook requests with its own signature that we verify manually.
 */
@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private stripe: StripeProvider,
    private prisma: PrismaService,
  ) {}

  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  async handleStripeWebhook(@Req() req: RawBodyRequest) {
    if (!this.stripe.isEnabled()) {
      this.logger.warn('Stripe webhook received but Stripe is not configured');
      return { received: false };
    }

    const sig = req.headers['stripe-signature'] as string;
    if (!sig) {
      this.logger.warn('Stripe webhook missing signature header');
      return { received: false };
    }

    try {
      const rawBody = req.rawBody ?? req.body;
      if (!rawBody) {
        this.logger.error('Stripe webhook missing raw body — raw-body middleware may not be configured');
        return { received: false };
      }
      const event = this.stripe.verifyWebhookSignature(rawBody, sig);

      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          await this.handleCheckoutComplete(session.id);
          break;
        }
        default:
          this.logger.log(`Unhandled Stripe event type: ${event.type}`);
      }

      return { received: true };
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Stripe webhook verification failed');
      this.logger.error(`Stripe webhook verification failed: ${message}`);
      return { received: false, error: message };
    }
  }

  private async handleCheckoutComplete(sessionId: string) {
    const result = await this.stripe.handleCheckoutComplete(sessionId);

    // Find the advertiser and create an advertiser ledger credit entry
    const advertiser = await this.prisma.advertiser.findUnique({
      where: { id: result.advertiserId },
    });
    if (!advertiser) {
      this.logger.error(`Advertiser ${result.advertiserId} not found for checkout ${sessionId}`);
      return;
    }

    // Record deposit in advertiser ledger
    await this.prisma.advertiserLedger.create({
      data: {
        advertiserId: advertiser.id,
        entryType: 'credit',
        status: 'confirmed',
        amountMinor: result.amountMinor,
        currency: result.currency.toUpperCase(),
        stripePaymentIntentId: result.paymentIntentId,
        idempotencyKey: `stripe_deposit_${result.paymentIntentId}`,
        description: `Stripe deposit — session ${sessionId}`,
      },
    });

    this.logger.log(`Recorded Stripe deposit: ${result.amountMinor} ${result.currency} for advertiser ${advertiser.id}`);
  }
}
