/* MAIN */

const getCodePointsLength = (() => {
	const SURROGATE_PAIR_RE = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;

	return (input: string): number => {
		let surrogatePairsNr = 0;

		SURROGATE_PAIR_RE.lastIndex = 0;

		while (SURROGATE_PAIR_RE.test(input)) {
			surrogatePairsNr += 1;
		}

		return input.length - surrogatePairsNr;
	};
})();

const isFullWidth = (x: number): boolean => {
	return x === 0x3000 || (x >= 0xff01 && x <= 0xff60) || (x >= 0xffe0 && x <= 0xffe6);
};

const isWideNotCJKTNotEmoji = (x: number): boolean => {
	return (
		x === 0x231b ||
		x === 0x2329 ||
		(x >= 0x2ff0 && x <= 0x2fff) ||
		(x >= 0x3001 && x <= 0x303e) ||
		(x >= 0x3099 && x <= 0x30ff) ||
		(x >= 0x3105 && x <= 0x312f) ||
		(x >= 0x3131 && x <= 0x318e) ||
		(x >= 0x3190 && x <= 0x31e3) ||
		(x >= 0x31ef && x <= 0x321e) ||
		(x >= 0x3220 && x <= 0x3247) ||
		(x >= 0x3250 && x <= 0x4dbf) ||
		(x >= 0xfe10 && x <= 0xfe19) ||
		(x >= 0xfe30 && x <= 0xfe52) ||
		(x >= 0xfe54 && x <= 0xfe66) ||
		(x >= 0xfe68 && x <= 0xfe6b) ||
		(x >= 0x1f200 && x <= 0x1f202) ||
		(x >= 0x1f210 && x <= 0x1f23b) ||
		(x >= 0x1f240 && x <= 0x1f248) ||
		(x >= 0x20000 && x <= 0x2fffd) ||
		(x >= 0x30000 && x <= 0x3fffd)
	);
};

/* EXPORT */

export { getCodePointsLength, isFullWidth, isWideNotCJKTNotEmoji };
