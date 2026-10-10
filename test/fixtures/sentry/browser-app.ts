// The page script for capture-browser.ts. It runs in a real browser and sends errors with the
// real @sentry/browser SDK. The capture tool bundles it, minified, like a production app.
import * as Sentry from "@sentry/browser";

declare const DSN: string;

Sentry.init({ dsn: DSN, release: "fixture-web@2.0.0", environment: "production" });
Sentry.setTag("page", "checkout");

type Cart = { items?: { price: number }[] };
function cartTotal(cart: Cart): number {
	return (cart.items as { price: number }[]).reduce((sum, item) => sum + item.price, 0);
}

const scenarios: Record<string, () => void> = {
	"browser-caught-type-error": () => {
		try {
			cartTotal({});
		} catch (error) {
			Sentry.captureException(error);
		}
	},
	"browser-unhandled-error": () => {
		setTimeout(() => {
			throw new Error("Checkout button handler failed for order 5521");
		});
	},
	"browser-unhandled-rejection": () => {
		void Promise.reject(new TypeError("Failed to fetch"));
	},
	"browser-message": () => {
		Sentry.captureMessage("Payment form shown 3 times without submit");
	},
};

const name = new URLSearchParams(location.search).get("scenario") ?? "";
document.title = name;
scenarios[name]?.();
