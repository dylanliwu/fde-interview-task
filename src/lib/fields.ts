import type { Line } from './types';

export type FieldType =
	| 'text'
	| 'textarea'
	| 'integer'
	| 'float'
	| 'currency'
	| 'checkbox'
	| 'single_select';

export type FieldDef = {
	field: keyof Line;
	header: string;
	type: FieldType;
	options?: readonly string[];
	required?: boolean;
};

export const FIELD_DEFS: readonly FieldDef[] = [
	{ field: 'isQuoting', header: 'Is Quoting?', type: 'checkbox' },
	{ field: 'priceBreaks', header: 'Price Breaks', type: 'currency', required: true },
	{ field: 'leadTime', header: 'Lead Time', type: 'integer', required: true },
	{
		field: 'dealerOrManufacturer',
		header: 'Type',
		type: 'single_select',
		options: ['Dealer', 'Manufacturer'],
		required: true
	},
	{ field: 'waiveFat', header: 'Waive Fat', type: 'checkbox', required: true },
	{ field: 'additionalNotes', header: 'Additional Notes', type: 'textarea' }
];

export function makeEmptyLine(quantity: number): Line {
	return {
		id: crypto.randomUUID(),
		quantity,
		isQuoting: null,
		priceBreaks: null,
		leadTime: null,
		dealerOrManufacturer: '',
		waiveFat: null,
		additionalNotes: ''
	};
}
