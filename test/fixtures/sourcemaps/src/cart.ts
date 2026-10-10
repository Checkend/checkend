// Fixture for source map tests. The bundle and the map are made from this file (see README.md).
export interface Line {
	price: number;
	quantity: number;
}

export function lineTotal(line: Line): number {
	return line.price * line.quantity;
}

export function cartTotal(cart: { lines?: Line[] }): number {
	let total = 0;
	for (const line of cart.lines!) {
		total += lineTotal(line);
	}
	return total;
}

export function checkout(cart: { lines?: Line[] }): string {
	const total = cartTotal(cart);
	return `Total: ${total.toFixed(2)}`;
}
