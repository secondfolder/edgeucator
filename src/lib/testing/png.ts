import fs from 'node:fs';
import zlib from 'node:zlib';
import type { NormalizedRgbaImage } from '../halftone';

export function decodePngToNormalizedImage(filePath: string): NormalizedRgbaImage {
	const bytes = fs.readFileSync(filePath);
	let position = 8;
	let width = 0;
	let height = 0;
	let colorType = 0;
	const idatChunks: Uint8Array[] = [];
	while (position < bytes.length) {
		const length = bytes.readUInt32BE(position);
		const type = bytes.toString('ascii', position + 4, position + 8);
		const data = bytes.subarray(position + 8, position + 8 + length);
		position += length + 12;
		if (type === 'IHDR') {
			width = data.readUInt32BE(0);
			height = data.readUInt32BE(4);
			colorType = data[9];
		}
		if (type === 'IDAT') idatChunks.push(data);
		if (type === 'IEND') break;
	}
	const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
	const stride = width * channels;
	const raw = zlib.inflateSync(Buffer.concat(idatChunks));
	const rgba = new Float32Array(width * height * 4);
	let previous = Buffer.alloc(stride);
	let inputPosition = 0;
	for (let y = 0; y < height; y += 1) {
		const filter = raw[inputPosition++];
		const source = raw.subarray(inputPosition, inputPosition + stride);
		inputPosition += stride;
		const current = Buffer.alloc(stride);
		for (let x = 0; x < stride; x += 1) {
			const left = x >= channels ? current[x - channels] : 0;
			const up = previous[x];
			const upLeft = x >= channels ? previous[x - channels] : 0;
			let value = source[x];
			if (filter === 1) value += left;
			else if (filter === 2) value += up;
			else if (filter === 3) value += (left + up) >> 1;
			else if (filter === 4) {
				const predict = left + up - upLeft;
				const distanceLeft = Math.abs(predict - left);
				const distanceUp = Math.abs(predict - up);
				const distanceUpLeft = Math.abs(predict - upLeft);
				value +=
					distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft
						? left
						: distanceUp <= distanceUpLeft
							? up
							: upLeft;
			}
			current[x] = value & 255;
		}
		for (let x = 0; x < width; x += 1) {
			const sourceIndex = x * channels;
			const destIndex = (y * width + x) * 4;
			rgba[destIndex] = current[sourceIndex] / 255;
			rgba[destIndex + 1] = (channels > 1 ? current[sourceIndex + 1] : current[sourceIndex]) / 255;
			rgba[destIndex + 2] = (channels > 2 ? current[sourceIndex + 2] : current[sourceIndex]) / 255;
			rgba[destIndex + 3] = (channels === 4 ? current[sourceIndex + 3] : 255) / 255;
		}
		previous = current;
	}
	return { width, height, rgba };
}
