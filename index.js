const mkdirp = require('mkdirp')
const timeout = require('await-timeout')
const request = require('request-promise');
const cheerio = require('cheerio')
const titleCase = require('title-case')
const fs = require('fs')
const pkg = require('./package.json')
const sortArray = require('sort-array')
const moment = require('moment')
const slugify = require('slugify')
const md5File = require('md5-file')
const sharp = require('sharp')

const {crc32} = require('crc')

/**
 * Index of the databases and their URLs.
 */
let databases = {
	'TIC-80': [
		'https://tic.computer/play?cat=0&sort=1'
	]
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
)\n`
}

/**
 * Clean the given value to be DAT file safe.
 */
function cleanValue(val) {
	if (val && val.replace) {
		val = val.replace(new RegExp('"', 'g'), '\'')
	}
	if (val && val.trim) {
		val = val.trim()
	}
	return val
}

/**
 * Construct a DAT entry based on the given game.
 */
function datEntry(game) {
	gameEntries = ''
	if (game.description) {
		gameEntries += `\n	description "${cleanValue(game.description)}"`
	}
	if (game.homepage) {
		gameEntries += `\n	homepage "${cleanValue(game.homepage)}"`
	}
	if (game.developer) {
		gameEntries += `\n	developer "${cleanValue(game.developer)}"`
	}
	if (game.publisher) {
		gameEntries += `\n	publisher "${cleanValue(game.publisher)}"`
	}
	if (game.releaseyear) {
		gameEntries += `\n	releaseyear "${cleanValue(game.releaseyear)}"`
	}
	if (game.releasemonth) {
		gameEntries += `\n	releasemonth "${cleanValue(game.releasemonth)}"`
	}
	if (game.releaseday) {
		gameEntries += `\n	releaseday "${cleanValue(game.releaseday)}"`
	}
	if (game.download) {
		gameEntries += `\n	download "${cleanValue(game.download)}"`
	}
	if (game.users) {
		gameEntries += `\n	users "${cleanValue(game.users)}"`
	}
	if (game.genre) {
		gameEntries += `\n	genre "${cleanValue(game.genre)}"`
	}
	if (game.esrb_rating) {
		gameEntries += `\n	esrb_rating "${cleanValue(game.esrb_rating)}"`
	}
	return `
game (
	name "${cleanValue(game.name)}"${gameEntries}
	rom ( name "${cleanValue(game.name)}.tic" size "${cleanValue(game.size)}" md5 "${cleanValue(game.md5)}" crc ${cleanValue(game.crc)} )
)
`
}

/**
 * Quick clean of the given title.
 */
function cleanTitle(title) {
	if (!title) {
		return null
	}
	let output = title
		.replace('Fps', 'FPS')
		.replace('3 D', '3D')
		.replace('V1 ', 'v1')
		.replace('Thetextquest', 'TheTextQuest')
		.replace('Tic 80', 'TIC-80')
		.replace('Rpg', 'RPG')
		.replace('Rps', 'RPS')

	return output.trim()
}

/**
 * Scrap information and construct the DATs.
 */
async function constructDats() {
	mkdirp.sync('carts')
	for (let databaseName in databases) {
		console.log(databaseName)
		let finalList = []
		let urls = databases[databaseName]

		const requests = urls.map(url => request(url))
		Promise.all(requests).then((datas) => {
			entries = []

			for (let html of datas) {
				const $ = cheerio.load(html)
				$('div.cart').each(async (index, element) => {
					const id = $('img', element).attr('src').split('/')[2]
					const cartid = $('.thumbnail a', element).attr('href').split('=')[1]
					let name = $('h2', element).text()
					const downloadUrl = `https://tic.computer/cart/${id}/cart.tic`
					name = titleCase(name)
					const description = $('.text-muted', element).first().text()
					let developer = $('.text-muted', element).last().text()
					if (developer.startsWith('by ')) {
						developer = developer.substring(3)
					}

					const destcart = 'carts/' + cleanTitle(name) + '.tic'
					if (!fs.existsSync(destcart)) {
						const opts = {
							url: downloadUrl,
							encoding: null
						}
						let cartRes = null
						try {
							cartRes = await request(opts)
						}
						catch (error) {
							console.error(error)
						}
						fs.writeFileSync(destcart, cartRes)

						await timeout.set(500)
					}

					const md5 = md5File.sync(destcart)

					const stat = fs.statSync(destcart)
					const size = stat.size

					// Thumbnail
					const destcover = 'thumbnails/Named_Titles/' + cleanTitle(name) + '.png'
					if (!fs.existsSync(destcover)) {
						const requestOpts = {
							url: `https://tic.computer/cart/${id}/cover.gif`,
							encoding: null
						}
						cover = await request(requestOpts)
						await sharp(cover)
							.toFile(destcover)
					}

					const crcVal = crc32(fs.readFileSync(destcart, 'utf8')).toString(16)

					entries.push({
						name: cleanTitle(name),
						id: id,
						size: size,
						crc: crcVal,
						download: downloadUrl,
						md5: md5,
						cartid: cartid,
						homepage: cartid ? "https://tic.computer/play?cart=" + cartid : '',
						description: description,
						developer: developer
					})
				})
			}

			let outputDat = header(databaseName, pkg.version, pkg.homepage)
			entries = sortArray(entries, ['name', 'cartid'])
			for (let entry of entries) {
				outputDat += datEntry(entry)
			}

			fs.writeFileSync('libretro-database/dat/' + databaseName + '.dat', outputDat)
		})

	}

};

constructDats();