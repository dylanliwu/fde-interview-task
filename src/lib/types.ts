export type Line = {
	id: string;
	quantity: number;

	isQuoting: boolean | null;
	priceBreaks: number | null;
	leadTime: number | null;
	dealerOrManufacturer: 'Dealer' | 'Manufacturer' | '';
	waiveFat: boolean | null;
	additionalNotes: string;
};

export type Product = {
	id: string;
	partNumber: string;
	nsn: string;
	description: string;
	lines: Line[];
};

export type EmailAttachment = {
	id: string;
	filename: string;
	pages: string[];
};

export type Email = {
	id: string;
	from: string;
	fromName: string;
	to: string;
	date: string;
	subject: string;
	body: string;
	attachments: EmailAttachment[];
};

export type Vendor = {
	id: string;
	name: string;
	contactName: string;
	contactEmail: string;
	cage: string;
	submittedAt: string | null;
	emails: Email[];
	products: Product[];
};

export type AppState = {
	vendors: Vendor[];
};
