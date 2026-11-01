import fs from 'node:fs'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { setTimeout as sleep } from 'node:timers/promises'
import * as cheerio from 'cheerio'
import sharp from 'sharp'
import { titleCase } from 'title-case'
import pkg from './package.json' with { type: 'json' }

const site = 'https://tic80.com'

/**
 * Index of the databases and the tic80.com categories they're built from.
 */
const databases = {
	'TIC-80': [
		'games',
		'tech', // Formerly "Demos"
		'music',
		'demoscene'
	]
}

/**
 * How many carts to download at the same time.
 */
const concurrency = 4

/**
 * The fields written to each DAT entry, in order.
 */
const datFields = [
	'description',
	'homepage',
	'developer',
	'publisher',
	'releaseyear',
	'releasemonth',
	'releaseday',
	'download',
	'users',
	'genre',
	'esrb_rating'
]

/**
 * Casing fixes applied after title casing.
 */
const titleFixes = [
	[/\bIiiii\b/g, 'IIIII'],
	[/\bVvvvvv\b/g, 'VVVVVV'],
	[/\bFps/g, 'FPS'],
	[/\bWcq\b/g, 'WCQ'],
	[/\b3 D\b/g, '3D'],
	[/\b3d\b/g, '3D'],
	[/\bV1\b/g, 'v1'],
	[/\bOop\b/g, 'OOP'],
	[/\bTic[ -]?80\b/gi, 'TIC-80'],
	[/\bTic(?= )/g, 'TIC'],
	[/\bThetextquest\b/g, 'TheTextQuest'],
	[/\bOneminuteescape\b/g, 'OneMinuteEscape'],
	[/\bRpg\b/g, 'RPG'],
	[/\bRps\b/g, 'RPS'],
	[/\(ost\b/gi, '(OST'],
	[/\bArt\+game\b/g, 'Art+Game']
]

/**
 * Fetch the given URL, retrying on network errors and server errors.
 */
async function get(url, attempts = 3) {
	for (let attempt = 1; ; attempt++) {
		let response
		try {
			response = await fetch(url)
		}
		catch (error) {
			if (attempt >= attempts) {
				throw error
			}
			await sleep(1000 * 2 ** attempt)
			continue
		}
		if (response.ok) {
			return Buffer.from(await response.arrayBuffer())
		}
		const retryable = response.status === 429 || response.status >= 500
		if (!retryable || attempt >= attempts) {
			throw new Error(`HTTP ${response.status} for ${url}`)
		}
		await sleep(1000 * 2 ** attempt)
	}
}

/**
 * Map over the items, running at most `limit` at a time.
 */
async function mapLimit(items, limit, fn) {
	const results = new Array(items.length)
	let next = 0
	async function worker() {
		while (next < items.length) {
			const index = next++
			results[index] = await fn(items[index], index)
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
	return results
}

/**
 * Build the DAT's header info.
 */
function header(title, version, homepage) {
	return `clrmamepro (
	name "${title}"
	description "${title}"
	version "${version}"
	homepage "${homepage}"
	extensions "tic"
)\n`
}

/**
 * Clean the given value to be DAT file safe.
 */
function cleanValue(val) {
	return String(val)
		.replaceAll('"', '\'')
		.replace(/\s+/g, ' ')
		.trim()
}

/**
 * Construct a DAT entry based on the given game.
 */
function datEntry(game) {
	let gameEntries = ''
	for (const field of datFields) {
		if (game[field]) {
			gameEntries += `\n	${field} "${cleanValue(game[field])}"`
		}
	}
	const romName = cleanValue(game.name).replaceAll('/', '-') + '.tic'
	return `
game (
	name "${cleanValue(game.name)}"${gameEntries}
	rom ( name "${romName}" size "${game.size}" md5 "${game.md5}" crc "${game.crc}" )
)
`
}

/**
 * Quick clean of the given title.
 */
function cleanTitle(title) {
	let output = titleCase(title.toLowerCase().replaceAll('"', '\'').replace(/\s+/g, ' ').trim())
	for (const [pattern, replacement] of titleFixes) {
		output = output.replace(pattern, replacement)
	}
	return output
}

/**
 * The libretro thumbnail filename for the given game name.
 */
function thumbnailName(name) {
	return name.replace(/[&*/:`<>?\\|"[]/g, '_')
}

/**
 * Scrape every cart listed in the given tic80.com category.
 */
async function scrapeCategory(category) {
	const carts = []
	for (let page = 0; ; page++) {
		const html = await get(`${site}/play/${category}/top?page=${page}&partial=1`)
		const $ = cheerio.load(html.toString())
		const found = $('div.cart')
		found.each((_, element) => {
			const id = $('.cover-card img', element).attr('src').split('/')[2]
			const href = $('.cover-card a', element).attr('href')
			const texts = $('.text-muted', element).map((_, el) => $(el).text().trim()).get()
			let developer = ''
			if (texts.length && texts[texts.length - 1].startsWith('by ')) {
				developer = texts.pop().substring(3)
			}
			carts.push({
				id,
				title: $('h2', element).text(),
				homepage: href ? site + href : '',
				description: texts[0] || '',
				developer,
				uploader: href ? href.split('/')[2] : '',
				slug: href ? href.split('/')[3] : ''
			})
		})
		if (!found.length || !$('.catalog-more').length) {
			break
		}
	}
	if (!carts.length) {
		throw new Error(`No carts found in "${category}". Has the tic80.com markup changed?`)
	}
	console.log(`${category}: ${carts.length} carts`)
	return carts
}

/**
 * Give every cart a unique name, appending the developer, then the uploader,
 * then the page slug, then the ID, to any names that clash. A suffix is only used when it tells
 * the clashing carts apart.
 */
function assignNames(carts) {
	const suffixes = [
		(cart) => cleanValue(cart.developer),
		(cart) => cart.uploader,
		(cart) => cart.slug,
		(cart) => cart.id.substring(0, 8)
	]
	for (const cart of carts) {
		cart.name = cleanTitle(cart.title)
	}
	for (const suffix of suffixes) {
		const groups = Map.groupBy(carts, (cart) => thumbnailName(cart.name).toLowerCase())
		for (const group of groups.values()) {
			const values = new Set(group.map((cart) => suffix(cart).toLowerCase()))
			if (group.length > 1 && values.size > 1) {
				for (const cart of group) {
					if (suffix(cart)) {
						cart.name += ` (${suffix(cart)})`
					}
				}
			}
		}
	}
}

/**
 * Download the cart, if needed, and add its size and hashes.
 */
async function downloadCart(cart) {
	const file = `carts/${cart.id}.tic`
	if (!fs.existsSync(file)) {
		const data = await get(`${site}/cart/${cart.id}/cart.tic`)
		fs.writeFileSync(file + '.part', data)
		fs.renameSync(file + '.part', file)
	}
	const data = fs.readFileSync(file)
	return {
		...cart,
		download: `${site}/cart/${cart.id}/cart.tic`,
		size: data.length,
		md5: crypto.createHash('md5').update(data).digest('hex'),
		crc: zlib.crc32(data).toString(16).padStart(8, '0')
	}
}

/**
 * Download the cart's cover as its boxart thumbnail, if needed.
 */
async function downloadThumbnail(cart) {
	const file = `thumbnails/Named_Boxarts/${thumbnailName(cart.name)}.png`
	if (!fs.existsSync(file)) {
		const cover = await get(`${site}/cart/${cart.id}/cover.gif`)
		await sharp(cover).png().toFile(file)
	}
}

/**
 * Scrape information and construct the DATs.
 */
async function constructDats() {
	fs.mkdirSync('carts', { recursive: true })
	fs.mkdirSync('thumbnails/Named_Boxarts', { recursive: true })
	fs.mkdirSync('libretro-database/dat', { recursive: true })
	const version = new Date().toISOString().substring(0, 10).replaceAll('-', '.')
	let failures = 0

	for (const [databaseName, categories] of Object.entries(databases)) {
		console.log(databaseName)
		const carts = new Map()
		for (const category of categories) {
			for (const cart of await scrapeCategory(category)) {
				if (!carts.has(cart.id)) {
					carts.set(cart.id, cart)
				}
			}
		}
		const list = [...carts.values()]
		assignNames(list)

		const entries = await mapLimit(list, concurrency, async (cart, index) => {
			let entry
			try {
				entry = await downloadCart(cart)
			}
			catch (error) {
				failures++
				console.error(`Failed to download cart "${cart.title}" (${cart.id}): ${error.message}`)
				return null
			}
			try {
				await downloadThumbnail(entry)
			}
			catch (error) {
				failures++
				console.error(`Failed to download thumbnail "${cart.title}" (${cart.id}): ${error.message}`)
			}
			if ((index + 1) % 100 === 0) {
				console.log(`${index + 1}/${list.length}`)
			}
			return entry
		})

		const sorted = entries
			.filter(Boolean)
			.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1)

		let outputDat = header(databaseName, version, pkg.homepage)
		for (const entry of sorted) {
			outputDat += datEntry(entry)
		}
		fs.writeFileSync(`libretro-database/dat/${databaseName}.dat`, outputDat)
		console.log(`Wrote ${sorted.length} entries to libretro-database/dat/${databaseName}.dat`)
	}

	if (failures) {
		console.error(`${failures} downloads failed`)
		process.exitCode = 1
	}
}

await constructDats()
