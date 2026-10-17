/**
 * My Beer - stock (beer-in-stock.json) and ratings (Untappd check-in export). Toggle between them.
 */

(function () {
	'use strict';

	var stockBeers = [];
	var ratingBeers = [];
	var mode = 'stock'; // 'stock' | 'ratings'
	var beers = []; // current list (stockBeers or ratingBeers depending on mode)
	var currentSort = 'alpha';
	var sortDir = 1;
	var activeFilters = { style: new Set(), brewery: new Set() };
	var filterOpen = false;
	var inited = false;
	var stockLocationFilter = 'all'; // 'all' | 'fridge' | 'cupboard' | 'drank' | 'archive'
	var stockLayout = 'list'; // 'list' | 'shelf' (stock only); fridge & cupboard shelf = 4 cols per sub-grid, all = 6
	var recentlyDrank = []; // drink events { id, item_id, beer_name, …, consumed_at, quantity_consumed }
	var drankArchive = []; // same shape; moved from Drank; optional archived_at
	var SWIPE_THRESHOLD_PX = 48;
	var stockToastHideTimer = null;

	function beerDisplayName(b) {
		if (!b || typeof b !== 'object') return 'Beer';
		var name = (b.beer_name != null ? String(b.beer_name) : '').trim();
		var brewery = (b.brewery_name != null ? String(b.brewery_name) : '').trim();
		if (brewery && name) return brewery + ' ' + name;
		return name || brewery || 'Beer';
	}

	function showStockActionToast(message) {
		var el = get('stockToast');
		if (!el || !message) return;
		if (stockToastHideTimer) {
			clearTimeout(stockToastHideTimer);
			stockToastHideTimer = null;
		}
		el.textContent = message;
		el.classList.add('stock-toast--visible');
		stockToastHideTimer = setTimeout(function () {
			el.classList.remove('stock-toast--visible');
			stockToastHideTimer = setTimeout(function () {
				el.textContent = '';
				stockToastHideTimer = null;
			}, 280);
		}, 2800);
	}
	var journalSort = 'date';
	var journalSortDir = 1;
	var journalSortBarWired = false;
	var journalTasteMapWired = false;
	var JOURNAL_LIST_CAP = 10;
	var journalShowAll = false;
	var journalPalateOpen = true;
	var JOURNAL_SORTS = [
		{ key: 'date', icon: '📅', label: 'Date' },
		{ key: 'rating', icon: '★', label: 'Rating' },
		{ key: 'abv', icon: '%', label: 'ABV' },
		{ key: 'style', icon: '🍺', label: 'Style' },
		{ key: 'alpha', icon: '🔤', label: 'A–Z' }
	];

	function get(id) { return document.getElementById(id); }

	function loadStockViewPrefs() {
		try {
			if (typeof localStorage === 'undefined') return;
			var sl = localStorage.getItem('mybeer_stock_layout');
			if (sl === 'list' || sl === 'shelf') stockLayout = sl;
		} catch (e) {}
	}

	function loadJournalViewPrefs() {
		try {
			if (typeof localStorage === 'undefined') return;
			if (localStorage.getItem('mybeer_palate_open') === '0') journalPalateOpen = false;
		} catch (e) {}
	}

	function saveJournalViewPrefs() {
		try {
			if (typeof localStorage !== 'undefined') localStorage.setItem('mybeer_palate_open', journalPalateOpen ? '1' : '0');
		} catch (e) {}
	}

	function formatRatingDate(s) {
		if (!s) return '';
		var part = String(s).trim().split(' ')[0];
		if (!part) return s;
		var bits = part.split('-');
		if (bits.length < 2) return s;
		var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
		var month = months[parseInt(bits[1], 10) - 1] || bits[1];
		var day = bits[2] ? parseInt(bits[2], 10) : 0;
		var year = bits[0];
		return day ? day + ' ' + month + ' ' + year : month + ' ' + year;
	}

	function setBeersFromMode() {
		beers = mode === 'stock' ? stockBeers : ratingBeers;
	}

	/** Untappd's generic "Insiders" banner: some brewery pages serve it instead of a logo. Treat as no image. */
	function isUntappdPromoImage(url) {
		return String(url || '').indexOf('insiders.untappd.com') >= 0;
	}

	function getImageUrl(b) {
		if (b.image_url && !isUntappdPromoImage(b.image_url)) return b.image_url;
		if (mode === 'ratings' && b.item_id) {
			for (var i = 0; i < stockBeers.length; i++) {
				var stockImg = stockBeers[i].image_url;
				if (stockBeers[i].item_id === b.item_id && stockImg && !isUntappdPromoImage(stockImg)) return stockImg;
			}
		}
		return null;
	}

	function chipSourceList() {
		if (mode === 'stock' && stockLocationFilter === 'drank') return recentlyDrank;
		if (mode === 'stock' && stockLocationFilter === 'archive') return drankArchive;
		return beers;
	}

	function availableStyles() {
		var seen = {};
		chipSourceList().forEach(function (b) { if (b.beer_type) seen[b.beer_type] = true; });
		return Object.keys(seen).sort();
	}

	function availableBreweries() {
		var seen = {};
		chipSourceList().forEach(function (b) { if (b.brewery_name) seen[b.brewery_name] = true; });
		return Object.keys(seen).sort();
	}

	function buildChips(containerId, values, activeSet) {
		var container = get(containerId);
		if (!container) return;
		container.innerHTML = '';
		values.forEach(function (val) {
			var btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'chip' + (activeSet.has(val) ? ' active' : '');
			btn.textContent = val;
			btn.dataset.value = val;
			container.appendChild(btn);
		});
	}

	function refreshChips() {
		buildChips('chipsStyle', availableStyles(), activeFilters.style);
		buildChips('chipsBrewery', availableBreweries(), activeFilters.brewery);
	}

	function setFilterOpen(open) {
		filterOpen = open;
		var panel = get('filterPanel');
		var toggle = get('filterToggle');
		if (panel) panel.classList.toggle('open', open);
		if (toggle) toggle.classList.toggle('active', open);
		if (open) refreshChips();
	}

	function updateStats() {
		var statsEl = get('beerStats');
		if (!statsEl) return;
		if (mode === 'stock') {
			var types = stockBeers.length;
			var totalBottles = 0;
			stockBeers.forEach(function (b) { totalBottles += (b.quantity || 0); });
			statsEl.textContent = types + ' TYPES · ' + totalBottles + ' TOTAL';
		} else {
			var rated = ratingBeers.length;
			var lastDate = '';
			ratingBeers.forEach(function (b) {
				var d = b.created_at;
				if (d && (!lastDate || String(d) > lastDate)) lastDate = String(d);
			});
			statsEl.textContent = rated + ' rated' + (lastDate ? ' · Last: ' + formatRatingDate(lastDate) : '');
		}
	}

	function filteredBeers() {
		var query = (get('searchInput') && get('searchInput').value || '').trim().toLowerCase();
		var hasStyle = activeFilters.style.size > 0;
		var hasBrewery = activeFilters.brewery.size > 0;

		return beers.filter(function (b) {
			if (query) {
				var name = (b.beer_name || '').toLowerCase();
				var brewery = (b.brewery_name || '').toLowerCase();
				var style = (b.beer_type || '').toLowerCase();
				if (name.indexOf(query) === -1 && brewery.indexOf(query) === -1 && style.indexOf(query) === -1) return false;
			}
			if (hasStyle && !activeFilters.style.has(b.beer_type || '')) return false;
			if (hasBrewery && !activeFilters.brewery.has(b.brewery_name || '')) return false;
			if (mode === 'stock' && stockLocationFilter === 'fridge') {
				if (b.stock_location_unspecified) {
					if ((b.quantity || 0) <= 0) return false;
				} else if ((b.in_fridge || 0) <= 0) return false;
			}
			if (mode === 'stock' && stockLocationFilter === 'cupboard') {
				if (b.stock_location_unspecified) {
					if ((b.quantity || 0) <= 0) return false;
				} else {
					var inCupboard = b.in_cupboard != null ? Number(b.in_cupboard) : ((b.quantity || 0) - (b.in_fridge || 0));
					if (inCupboard <= 0) return false;
				}
			}
			if (mode === 'stock' && stockLocationFilter === 'drank') return false;
			if (mode === 'stock' && stockLocationFilter === 'archive') return false;
			return true;
		});
	}

	function filteredDrankEvents() {
		var query = (get('searchInput') && get('searchInput').value || '').trim().toLowerCase();
		var hasStyle = activeFilters.style.size > 0;
		var hasBrewery = activeFilters.brewery.size > 0;
		return recentlyDrank.filter(function (e) {
			if (query) {
				var name = (e.beer_name || '').toLowerCase();
				var brewery = (e.brewery_name || '').toLowerCase();
				var style = (e.beer_type || '').toLowerCase();
				if (name.indexOf(query) === -1 && brewery.indexOf(query) === -1 && style.indexOf(query) === -1) return false;
			}
			if (hasStyle && !activeFilters.style.has(e.beer_type || '')) return false;
			if (hasBrewery && !activeFilters.brewery.has(e.brewery_name || '')) return false;
			return true;
		});
	}

	function filteredArchiveEvents() {
		var query = (get('searchInput') && get('searchInput').value || '').trim().toLowerCase();
		var hasStyle = activeFilters.style.size > 0;
		var hasBrewery = activeFilters.brewery.size > 0;
		return drankArchive.filter(function (e) {
			if (query) {
				var name = (e.beer_name || '').toLowerCase();
				var brewery = (e.brewery_name || '').toLowerCase();
				var style = (e.beer_type || '').toLowerCase();
				if (name.indexOf(query) === -1 && brewery.indexOf(query) === -1 && style.indexOf(query) === -1) return false;
			}
			if (hasStyle && !activeFilters.style.has(e.beer_type || '')) return false;
			if (hasBrewery && !activeFilters.brewery.has(e.brewery_name || '')) return false;
			return true;
		});
	}

	/** Quantity for current stock location filter (for shelf badge). */
	function visibleQty(b) {
		if (mode !== 'stock') return 0;
		var qty = b.quantity != null && b.quantity > 0 ? Number(b.quantity) : 0;
		if (b.stock_location_unspecified) return Math.max(0, qty);
		var inFridge = b.in_fridge != null ? Number(b.in_fridge) : 0;
		var inCupboard = b.in_cupboard != null ? Number(b.in_cupboard) : Math.max(0, qty - inFridge);
		if (stockLocationFilter === 'fridge') return Math.max(0, inFridge);
		if (stockLocationFilter === 'cupboard') return Math.max(0, inCupboard);
		return Math.max(0, qty);
	}

	function updateFilterCount(visible, total) {
		var n = activeFilters.style.size + activeFilters.brewery.size;
		var toggleEl = get('filterToggle');
		if (toggleEl) toggleEl.classList.toggle('has-filters', n > 0);
		var badge = get('filterBadge');
		if (badge) {
			badge.textContent = n > 0 ? String(n) : '';
			badge.classList.toggle('hidden', n === 0);
		}
		var el = get('filterCount');
		if (el) el.textContent = visible < total ? visible + ' of ' + total : 'All ' + total;
		renderActiveFilterPills();
	}

	/** Active brewery/style filters as removable pills under the search bar. */
	function renderActiveFilterPills() {
		var el = get('activeFilterPills');
		if (!el) return;
		var html = '';
		['brewery', 'style'].forEach(function (key) {
			activeFilters[key].forEach(function (val) {
				html += '<button type="button" class="filter-pill" data-filter-key="' + key + '" data-value="' + encodeURIComponent(val) + '">' +
					'<span class="filter-pill-name">' + escapeHtml(val) + '</span><span class="filter-pill-x" aria-hidden="true">✕</span></button>';
			});
		});
		el.innerHTML = html;
	}

	function escapeHtml(s) {
		if (s == null || s === '') return '';
		var div = document.createElement('div');
		div.textContent = s;
		return div.innerHTML;
	}

	function buildDetailSectionHtml(b) {
		var detailParts = [];
		if (b.notes) detailParts.push('<p class="item-notes">' + escapeHtml(b.notes) + '</p>');
		if (b.best_by_date_iso) detailParts.push('<p class="item-best-by">Best by: ' + escapeHtml(b.best_by_date_iso) + '</p>');
		if (b.comment) detailParts.push('<p class="item-notes">' + escapeHtml(b.comment) + '</p>');
		return detailParts.length ? '<div class="item-detail">' + detailParts.join('') + '</div>' : '';
	}

	var PALATE_BREWERY_TOP_N = 12;

	function computeStats(beers) {
		var rated = beers.filter(function (b) {
			return normaliseUserRatingScoreForStorage(b.rating_score) != null;
		});
		if (!rated.length) return null;
		var goldCount = rated.filter(function (b) { return normaliseUserRatingScoreForStorage(b.rating_score) >= 4.5; }).length;
		var brewMap = {};
		rated.forEach(function (b) {
			var k = (b.brewery_name != null ? String(b.brewery_name) : '').trim() || 'Unknown brewery';
			if (!brewMap[k]) brewMap[k] = { count: 0, total: 0 };
			brewMap[k].count++;
			brewMap[k].total += normaliseUserRatingScoreForStorage(b.rating_score);
		});
		var allBrew = [];
		Object.keys(brewMap).forEach(function (k) {
			var v = brewMap[k];
			allBrew.push({ name: k, count: v.count, avg: v.total / v.count });
		});
		var byScore = allBrew.filter(function (b) { return b.count >= 2; }).sort(function (a, b) {
			if (b.avg !== a.avg) return b.avg - a.avg;
			return b.count - a.count;
		});
		var byQty = allBrew.filter(function (b) { return b.count >= 1; }).sort(function (a, b) {
			if (b.count !== a.count) return b.count - a.count;
			return b.avg - a.avg;
		});
		return {
			goldCount: goldCount,
			rated: rated,
			byScoreBreweries: byScore.slice(0, PALATE_BREWERY_TOP_N),
			byQtyBreweries: byQty.slice(0, PALATE_BREWERY_TOP_N),
			breweryCount: allBrew.length
		};
	}

	function buildHistogram(rated) {
		var buckets = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
		var counts = buckets.map(function (b) {
			return rated.filter(function (d) {
				var r = normaliseUserRatingScoreForStorage(d.rating_score);
				return r != null && Math.round(r * 2) / 2 === b;
			}).length;
		});
		var maxCount = Math.max.apply(null, counts.concat([1]));
		var maxBarPx = 84;
		var minBarPx = 5;
		var html = '<div class="histogram">';
		buckets.forEach(function (b, i) {
			var c = counts[i];
			var barH = c === 0 ? minBarPx : Math.round(minBarPx + (c / maxCount) * (maxBarPx - minBarPx));
			var cls = 'hist-bar';
			if (c === maxCount && c > 0) cls += ' hist-top';
			else if (c > 0 && c >= maxCount * 0.65) cls += ' hist-peak';
			html += '<div class="hist-col">' +
				'<div class="hist-bar-track">' +
				'<div class="' + cls + '" style="height:' + barH + 'px" title="' + b + '★: ' + c + '"></div>' +
				'</div>' +
				'<div class="hist-lbl">' + b + '</div>' +
				'</div>';
		});
		html += '</div>';
		return html;
	}

	function buildPalateRankColumn(title, hint, rows, metricKey) {
		var html = '<div class="palate-rank-col">' +
			'<div class="palate-rank-col-head">' +
			'<span class="palate-rank-col-title">' + title + '</span>' +
			(hint ? '<span class="palate-rank-col-hint">' + hint + '</span>' : '') +
			'</div>';
		if (!rows.length) {
			html += '<div class="palate-rank-empty">Not enough data yet</div></div>';
			return html;
		}
		html += '<div class="palate-rank-list">';
		rows.forEach(function (br, idx) {
			var rank = idx + 1;
			var metric = metricKey === 'score'
				? br.avg.toFixed(2) + '★'
				: String(br.count);
			var active = activeFilters.brewery.has(br.name);
			html +=
				'<button type="button" class="palate-rank-row' + (rank <= 3 ? ' palate-rank-row--top' : '') + (active ? ' palate-rank-row--active' : '') + '" ' +
				'data-brewery="' + encodeURIComponent(br.name) + '" aria-pressed="' + active + '">' +
				'<span class="palate-rank-num">' + rank + '</span>' +
				'<span class="palate-rank-name" title="' + escapeHtml(br.name) + '">' + escapeHtml(br.name) + '</span>' +
				'<span class="palate-rank-metric">' + metric + '</span>' +
				'</button>';
		});
		html += '</div></div>';
		return html;
	}

	/** Journal top: brewery rankings. Tap a row to filter the list below; the palate charts render after the list. */
	function renderDashboard() {
		var el = get('journalDashboard');
		if (!el) return;
		var stats = ratingBeers.length ? computeStats(ratingBeers) : null;
		if (!stats) {
			el.innerHTML = '';
			renderPalate(null);
			return;
		}
		el.innerHTML =
			'<div class="journal-dash-stack">' +
			'<div class="dash-card wide dash-card--palate-ranks">' +
			'<div class="dash-lbl dash-lbl--split"><span>Brewery rankings</span><span class="dash-hint">tap to filter ↓</span></div>' +
			'<div class="palate-rank-split">' +
			buildPalateRankColumn('By your score', '', stats.byScoreBreweries || [], 'score') +
			buildPalateRankColumn('Check-ins', '', stats.byQtyBreweries || [], 'qty') +
			'</div></div>' +
			'</div>';
		renderPalate(stats);
	}

	/** Journal bottom, after the list: rating distribution, taste map, then the counts. Foldable. */
	function renderPalate(stats) {
		var el = get('journalPalate');
		if (!el) return;
		if (!stats) {
			el.innerHTML = '';
			return;
		}
		var html = '<button type="button" class="palate-toggle" id="palateToggle" aria-expanded="' + journalPalateOpen + '">' +
			'<span>Your palate ' + (journalPalateOpen ? '▴' : '▾') + '</span></button>';
		if (journalPalateOpen) {
			html +=
				'<div class="journal-dash-stack">' +
				'<div class="dash-card wide"><div class="dash-lbl">Rating distribution</div><div class="histogram-wrap">' + buildHistogram(stats.rated) + '</div></div>' +
				buildTasteMapHtml(stats.rated) +
				'<div class="dashboard-grid">' +
				'<div class="dash-card"><div class="dash-lbl">Gold tier</div><div class="dash-val">' + stats.goldCount + '</div><div class="dash-sub">4.5★ or above</div></div>' +
				'<div class="dash-card"><div class="dash-lbl">Your journal</div><div class="dash-val">' + stats.rated.length + '</div><div class="dash-sub">' + (stats.breweryCount || 0) + ' breweries</div></div>' +
				'</div>' +
				'</div>';
		}
		el.innerHTML = html;
	}

	function sortJournalItems(arr) {
		var key = journalSort;
		var dir = journalSortDir;
		return arr.slice().sort(function (a, b) {
			if (key === 'alpha') return dir * (a.beer_name || '').localeCompare(b.beer_name || '');
			if (key === 'abv') return dir * ((parseFloat(b.beer_abv) || 0) - (parseFloat(a.beer_abv) || 0));
			if (key === 'rating') return dir * (userRatingSortKey(b) - userRatingSortKey(a));
			if (key === 'date') return dir * String(b.created_at || '').localeCompare(String(a.created_at || ''));
			if (key === 'style') {
				var s = (a.beer_type || '').localeCompare(b.beer_type || '');
				return dir * (s !== 0 ? s : (a.beer_name || '').localeCompare(b.beer_name || ''));
			}
			return 0;
		});
	}

	function renderJournalSortBar() {
		var bar = get('journalSortBar');
		if (!bar) return;
		if (!journalSortBarWired) {
			journalSortBarWired = true;
			bar.addEventListener('click', function (e) {
				var btn = e.target.closest('.sort-pill');
				if (!btn || !btn.dataset.key) return;
				var k = btn.dataset.key;
				if (journalSort === k) journalSortDir *= -1;
				else {
					journalSort = k;
					journalSortDir = 1;
				}
				renderJournalSortBar();
				render();
			});
		}
		bar.innerHTML = '';
		JOURNAL_SORTS.forEach(function (opt) {
			var active = journalSort === opt.key;
			var btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'sort-pill' + (active ? ' active' : '');
			btn.dataset.key = opt.key;
			btn.innerHTML = '<span>' + opt.icon + '</span><span>' + opt.label + '</span>' +
				(active ? '<span class="pill-arrow">' + (journalSortDir === 1 ? '↓' : '↑') + '</span>' : '');
			bar.appendChild(btn);
		});
	}

	function parseOptionalRating(v) {
		if (v == null || v === '') return null;
		var n = parseFloat(v);
		return isNaN(n) ? null : n;
	}

	/** Untappd exports use 0 when you did not rate; treat as no rating. */
	function normaliseUserRatingScoreForStorage(v) {
		if (v == null || v === '') return null;
		var n = typeof v === 'number' ? v : parseFloat(v);
		if (isNaN(n) || n <= 0) return null;
		return n;
	}

	/** IBU 0 in data is not meaningful; hide like missing. */
	function normaliseBeerIbuForStorage(v) {
		if (v == null || v === '') return null;
		var n = typeof v === 'number' ? v : parseFloat(v);
		if (isNaN(n) || n <= 0) return null;
		return n;
	}

	function userRatingSortKey(b) {
		var n = normaliseUserRatingScoreForStorage(b.rating_score);
		return n != null ? n : -1;
	}

	function globalRatingFromCheckin(c) {
		if (!c || typeof c !== 'object') return null;
		var keys = ['beer_rating_score', 'beer_average_rating', 'weighted_rating_score', 'global_rating_score'];
		for (var i = 0; i < keys.length; i++) {
			var n = parseOptionalRating(c[keys[i]]);
			if (n != null) return n;
		}
		return null;
	}

	function getJournalGlobalRating(b) {
		if (!b) return null;
		var n = parseOptionalRating(b.untappd_global_rating);
		if (n != null) return n;
		n = parseOptionalRating(b.beer_rating_score);
		if (n != null) return n;
		return parseOptionalRating(b.global_rating_score);
	}

	function ordinalRank(n) {
		var j = n % 10;
		var k = n % 100;
		if (j === 1 && k !== 11) return n + 'st';
		if (j === 2 && k !== 12) return n + 'nd';
		if (j === 3 && k !== 13) return n + 'rd';
		return n + 'th';
	}

	/** Short plain-English hop bitterness hint for an IBU number (rough guide). */
	function ibuPlainEnglish(ibu) {
		var n = parseFloat(ibu);
		if (isNaN(n) || n < 0) return '';
		if (n < 20) return 'mild bitterness';
		if (n < 35) return 'moderate bitterness';
		if (n < 50) return 'noticeable bitterness';
		if (n < 70) return 'firm bitterness';
		if (n < 90) return 'strong bitterness';
		return 'very strong bitterness';
	}

	function buildJournalExpandedInsightHtml(b) {
		return buildJournalBreweryRankHtml(b) + buildJournalGlobalCompareHtml(b);
	}

	/** Your score beside the Untappd average, e.g. "You: 4.25 · Untappd average: 3.69 (+0.56)". */
	function buildJournalGlobalCompareHtml(b) {
		var gr = getJournalGlobalRating(b);
		if (gr == null || gr <= 0) return ''; // Untappd uses 0 for "not enough ratings yet"
		var mine = normaliseUserRatingScoreForStorage(b.rating_score);
		if (mine == null) return '<p class="journal-insight">Untappd average ★ ' + gr.toFixed(2) + '</p>';
		var diff = mine - gr;
		var diffText = (diff >= 0 ? '+' : '−') + Math.abs(diff).toFixed(2);
		return '<p class="journal-insight">You: ' + mine.toFixed(2) + ' · Untappd average: ' + gr.toFixed(2) + ' (' + diffText + ')</p>';
	}

	/** Where this beer ranks among your journaled beers from the same brewery. */
	function buildJournalBreweryRankHtml(b) {
		var brewery = (b.brewery_name || '').trim();
		if (!brewery || !ratingBeers.length) return '';
		var bLower = brewery.toLowerCase();
		var peers = ratingBeers.filter(function (x) {
			return ((x.brewery_name || '').trim().toLowerCase() === bLower);
		});
		if (peers.length <= 1) {
			return '<p class="journal-insight">Only beer you&rsquo;ve journaled from ' + escapeHtml(brewery) + '</p>';
		}
		if (normaliseUserRatingScoreForStorage(b.rating_score) == null) return '';
		var sorted = peers.slice().sort(function (a, x) {
			var ra = userRatingSortKey(a);
			var rx = userRatingSortKey(x);
			if (rx !== ra) return rx - ra;
			return (a.beer_name || '').localeCompare(x.beer_name || '');
		});
		var idx = -1;
		for (var i = 0; i < sorted.length; i++) {
			if (sorted[i].item_id === b.item_id) {
				idx = i;
				break;
			}
		}
		if (idx < 0) return '';
		var rank = idx + 1;
		var total = peers.length;
		if (rank === 1) {
			return '<p class="journal-insight">Best rated in your journal from ' + escapeHtml(brewery) + '</p>';
		}
		return '<p class="journal-insight">' + ordinalRank(rank) + ' of ' + total + ' from ' + escapeHtml(brewery) + '</p>';
	}

	function buildJournalCard(b) {
		var userRating = normaliseUserRatingScoreForStorage(b.rating_score);
		var isGold = userRating != null && userRating >= 4.5;
		var isPhoto = b.image_source === 'checkin_photo';
		var hasRating = userRating != null;
		var imgUrl = getImageUrl(b);
		var isPlaceholder = !imgUrl || (typeof imgUrl === 'string' && imgUrl.indexOf('badge-beer-default') >= 0);
		var comment = (b.comment != null && b.comment !== '') ? String(b.comment) : '';
		var shortComment = comment.length > 54 ? comment.slice(0, 54) + '…' : comment;

		var div = document.createElement('div');
		div.className = 'journal-card' + (isGold ? ' gold-tier' : '');

		var imgHtml = isPlaceholder
			? '<div class="card-img-placeholder">🍺</div>'
			: '<img class="card-img" src="' + escapeHtml(imgUrl) + '" alt="" loading="lazy">';

		var ratingHTML;
		if (hasRating) {
			ratingHTML = '<div class="rating-pill' + (isGold ? ' gold-pill' : '') + '">' +
				'<span class="rating-star">★</span>' +
				'<span class="rating-num">' + userRating.toFixed(2) + '</span>' +
				'</div>';
		} else {
			ratingHTML = '<div class="rating-pill"><span class="rating-none">—</span></div>';
		}

		var untappdHtml = (b.untappd_url)
			? '<a href="' + escapeHtml(b.untappd_url) + '" class="btn-untappd" target="_blank" rel="noopener">Untappd</a>'
			: '';

		var notesExpanded = (b.notes || b.best_by_date_iso)
			? ((b.notes ? '<p class="expanded-comment">' + escapeHtml(b.notes) + '</p>' : '') +
				(b.best_by_date_iso ? '<p class="expanded-comment">Best by: ' + escapeHtml(b.best_by_date_iso) + '</p>' : ''))
			: '';

		var insightHtml = buildJournalExpandedInsightHtml(b);

		var ibuVal = normaliseBeerIbuForStorage(b.beer_ibu);
		var ibuTag = '';
		if (ibuVal != null) {
			var ibuDesc = ibuPlainEnglish(ibuVal);
			ibuTag = '<span class="style-tag">' + escapeHtml(String(ibuVal)) + ' IBU' +
				(ibuDesc ? ' · ' + escapeHtml(ibuDesc) : '') + '</span>';
		}

		div.innerHTML =
			'<div class="gold-strip"></div>' +
			'<div class="gold-star-badge">✦</div>' +
			'<div class="journal-card-main">' +
			'<div class="card-img-wrap' + (isPhoto ? ' is-photo' : '') + '">' +
			imgHtml +
			'<div class="camera-badge" aria-hidden="true">📷</div>' +
			'</div>' +
			'<div class="journal-info">' +
			'<div class="journal-name">' + escapeHtml(b.beer_name || '') + '</div>' +
			'<div class="journal-meta">' + escapeHtml(b.brewery_name || '') + (b.beer_abv != null && b.beer_abv !== '' ? ' · ' + b.beer_abv + '%' : '') + '</div>' +
			(shortComment ? '<div class="journal-comment">"' + escapeHtml(shortComment) + '"</div>' : '') +
			'<div class="journal-date">' + escapeHtml(formatRatingDate(b.created_at)) + '</div>' +
			'</div>' +
			'<div class="journal-right">' +
			ratingHTML +
			untappdHtml +
			'</div>' +
			'</div>' +
			'<div class="journal-expanded">' +
			(comment.length > 54 ? '<div class="expanded-comment">"' + escapeHtml(comment) + '"</div>' : '') +
			notesExpanded +
			insightHtml +
			'<div class="tag-row">' +
			(b.beer_type ? '<span class="style-tag">' + escapeHtml(b.beer_type) + '</span>' : '') +
			ibuTag +
			'</div>' +
			'</div>';

		div.addEventListener('click', function (e) {
			if (e.target.closest('a')) return;
			var wasExpanded = div.classList.contains('expanded');
			document.querySelectorAll('.journal-card.expanded').forEach(function (el) { el.classList.remove('expanded'); });
			if (!wasExpanded) div.classList.add('expanded');
		});

		return div;
	}

	function buildDrankCard(entry) {
		var div = document.createElement('div');
		div.className = 'item item--drank';
		var imgUrl = isUntappdPromoImage(entry.image_url) ? null : entry.image_url;
		var imgHtml = imgUrl
			? '<img class="item-img" src="' + escapeHtml(imgUrl) + '" alt="" loading="lazy">'
			: '<div class="item-img item-img-placeholder">🍺</div>';
		var when = entry.consumed_at ? formatRatingDate(String(entry.consumed_at).split('T')[0]) : '';
		if (!when && entry.consumed_at) when = String(entry.consumed_at).slice(0, 16).replace('T', ' ');
		var metaParts = [entry.brewery_name || '', entry.beer_type || ''].filter(Boolean);
		if (entry.beer_abv != null && entry.beer_abv !== '') metaParts.push(entry.beer_abv + '%');
		var mainHtml =
			'<div class="item-main item-main--swipe">' +
				imgHtml +
				'<div class="item-info">' +
					'<div class="item-title">' + escapeHtml(entry.beer_name || '') + '</div>' +
					'<div class="item-meta">' + escapeHtml(metaParts.join(' · ')) + '</div>' +
					'<div class="item-qty item-qty--drank-meta">Drank · ' + escapeHtml(when) + '</div>' +
					'<div class="swipe-hint">◀ Add to fridge · ▶ Move to archive</div>' +
				'</div>' +
			'</div>';
		div.innerHTML = mainHtml;
		var mainEl = div.querySelector('.item-main');
		wirePointerSwipeGesture(mainEl, div, {
			forward: function () { return moveDrankEntryToArchive(entry); },
			backward: function () { return restoreOneToFridgeFromDrankEntry(entry); }
		});
		return div;
	}

	function buildArchiveCard(entry) {
		var div = document.createElement('div');
		div.className = 'item item--archive';
		var imgUrl = isUntappdPromoImage(entry.image_url) ? null : entry.image_url;
		var imgHtml = imgUrl
			? '<img class="item-img" src="' + escapeHtml(imgUrl) + '" alt="" loading="lazy">'
			: '<div class="item-img item-img-placeholder">🍺</div>';
		var whenDrank = entry.consumed_at ? formatRatingDate(String(entry.consumed_at).split('T')[0]) : '';
		if (!whenDrank && entry.consumed_at) whenDrank = String(entry.consumed_at).slice(0, 16).replace('T', ' ');
		var whenArch = entry.archived_at ? formatRatingDate(String(entry.archived_at).split('T')[0]) : '';
		if (!whenArch && entry.archived_at) whenArch = String(entry.archived_at).slice(0, 16).replace('T', ' ');
		var metaParts = [entry.brewery_name || '', entry.beer_type || ''].filter(Boolean);
		if (entry.beer_abv != null && entry.beer_abv !== '') metaParts.push(entry.beer_abv + '%');
		var archiveLine = whenArch ? 'Archived · ' + escapeHtml(whenArch) : 'Archived';
		var mainHtml =
			'<div class="item-main item-main--swipe">' +
				imgHtml +
				'<div class="item-info">' +
					'<div class="item-title">' + escapeHtml(entry.beer_name || '') + '</div>' +
					'<div class="item-meta">' + escapeHtml(metaParts.join(' · ')) + '</div>' +
					'<div class="item-qty item-qty--archive-meta">Drank · ' + escapeHtml(whenDrank) + '</div>' +
					'<div class="item-qty item-qty--archive-meta item-qty--archive-sub">' + archiveLine + '</div>' +
					'<div class="swipe-hint">◀ Swipe to move back to Drank</div>' +
				'</div>' +
			'</div>';
		div.innerHTML = mainHtml;
		var mainEl = div.querySelector('.item-main');
		wirePointerSwipeGesture(mainEl, div, {
			forward: function () { return false; },
			backward: function () { return restoreArchiveEntryToDrank(entry); }
		});
		return div;
	}

	function buildCard(b) {
		var div = document.createElement('div');
		div.className = 'item';

		var imgUrl = getImageUrl(b);
		var imgHtml = imgUrl
			? '<img class="item-img" src="' + escapeHtml(imgUrl) + '" alt="" loading="lazy">'
			: '<div class="item-img item-img-placeholder">🍺</div>';

		var abvStr = b.beer_abv != null && b.beer_abv !== '' ? b.beer_abv + '%' : '';
		var metaParts = [b.brewery_name || '', b.beer_type || ''].filter(Boolean);
		if (abvStr) metaParts.push(abvStr);
		var qty = b.quantity != null && b.quantity > 0 ? Number(b.quantity) : 0;
		var inFridge = b.in_fridge != null ? Number(b.in_fridge) : 0;
		var inCupboard = b.in_cupboard != null ? Number(b.in_cupboard) : Math.max(0, qty - inFridge);
		var qtyStr = qty > 0 ? '×' + qty : '';
		if (!b.stock_location_unspecified && qty > 0) {
			if (inFridge > 0 && inCupboard > 0) qtyStr += ' (' + inFridge + ' fridge, ' + inCupboard + ' cupboard)';
			else if (inFridge > 0) qtyStr += inFridge > 1 ? ' (' + inFridge + ' fridge)' : ' (fridge)';
			else if (inCupboard > 0 && mode === 'stock') qtyStr += inCupboard > 1 ? ' (' + inCupboard + ' cupboard)' : ' (cupboard)';
		}
		var stockUserRating = normaliseUserRatingScoreForStorage(b.rating_score);
		var ratingStr = stockUserRating != null ? '★ ' + stockUserRating.toFixed(2) : '';
		var dateStr = b.created_at ? formatRatingDate(b.created_at) : '';

		var untappdHtml = (b.untappd_url)
			? '<a href="' + escapeHtml(b.untappd_url) + '" class="btn-link btn-untappd" target="_blank" rel="noopener">Untappd</a>'
			: '';

		var mainHtml =
			'<div class="item-main item-main--swipe">' +
				imgHtml +
				'<div class="item-info">' +
					'<div class="item-title">' + escapeHtml(b.beer_name || '') + '</div>' +
					'<div class="item-meta">' + escapeHtml(metaParts.join(' · ')) + '</div>' +
					(qtyStr ? '<div class="item-qty">' + escapeHtml(qtyStr) + '</div>' : '') +
					(ratingStr ? '<div class="item-rating">' + escapeHtml(ratingStr) + '</div>' : '') +
					(dateStr ? '<div class="item-date">' + escapeHtml(dateStr) + '</div>' : '') +
				'</div>' +
				'<div class="badge-stack">' + untappdHtml + '</div>' +
			'</div>';

		var detailHtml = buildDetailSectionHtml(b);

		div.innerHTML = mainHtml + detailHtml;

		var mainEl = div.querySelector('.item-main');
		if (mode === 'stock') {
			wirePointerSwipeGesture(mainEl, div, {
				forward: function () { return applyForwardSwipeOnBeer(b); },
				backward: function () { return applyBackwardSwipeOnBeer(b); }
			});
		}

		div.addEventListener('click', function (e) {
			if (e.target.closest('a')) return;
			if (div.dataset.swipeCommitted === '1') {
				delete div.dataset.swipeCommitted;
				return;
			}
			var wasExpanded = div.classList.contains('expanded');
			document.querySelectorAll('.item.expanded').forEach(function (el) { el.classList.remove('expanded'); });
			if (!wasExpanded) div.classList.add('expanded');
		});

		return div;
	}

	/**
	 * Shelf categories for Stock → Shelf multi-row layout (mutually exclusive).
	 * Order/precedence follows the request:
	 * - Session & Light (ABV <= 4.5)
	 * - Strong Stuff (ABV >= 8)
	 * - Otherwise split into Sours / Fruited / Dark by beer_type + beer_name hints
	 * - Remaining go to Core IPAs & Pales
	 */
	function categorizeShelfBeer(b) {
		var abv = parseFloat(b.beer_abv);
		var type = (b.beer_type || '').toLowerCase();
		var name = (b.beer_name || '').toLowerCase();
		var blob = type + ' ' + name;

		if (!isNaN(abv)) {
			if (abv <= 4.5) return 'session';
			if (abv >= 8) return 'strong';
		}

		// Only apply these when we're neither clearly light/session nor clearly strong.
		if (/sour|goose|berliner|lambic|kees/.test(blob)) return 'sours';
		// Keep this fairly strict: only explicit fruit/berry names should map to "Fruited".
		if (/fruit|berry|cherry|rasp|strawb|mango|passion|peach|plum/.test(blob)) return 'fruited';
		if (/stout|porter|brown|dark|schwarz|baltic|imperial/.test(blob)) return 'dark';
		return 'core';
	}

	function tasteMapHash(str) {
		var s = String(str || '');
		var h = 0;
		for (var i = 0; i < s.length; i++) {
			h = ((h << 5) - h) + s.charCodeAt(i);
			h |= 0;
		}
		return Math.abs(h);
	}

	/**
	 * NA / trace alcohol: distinct from "session" (flavour-led light beer).
	 */
	function tasteMapIsNaLow(blob, abvKnown, abv) {
		if (/non-alcoholic|non alcoholic|alcohol[\s-]?free|near beer|sin alcohol|alkoholfrei|0\.0\s*%|0,0\s*%|\b0\.0\b(?!\d)|n\/a beer|n\/a\s| alcohol removed/i.test(blob)) {
			return true;
		}
		if (abvKnown && abv >= 0 && abv <= 1.2) return true;
		return false;
	}

	/**
	 * Taste-map dot colour: style-first, then ABV fallbacks (session / strong / other).
	 * Shelf layout still uses categorizeShelfBeer — only the map uses this.
	 */
	function tasteMapStyleCategory(b) {
		var abv = parseFloat(b.beer_abv);
		var type = (b.beer_type || '').toLowerCase();
		var name = (b.beer_name || '').toLowerCase();
		var blob = type + ' ' + name;
		var abvKnown = !isNaN(abv);

		if (/sour|goose|berliner|lambic|kees|gueuze|flemish|kriek|wild ale|brett|coolship|mixed ferm/.test(blob)) return 'sours';
		if (/fruit|berry|cherry|rasp|strawb|mango|passion|peach|plum|pineapple|guava|passionfruit/.test(blob)) return 'fruited';

		if (tasteMapIsNaLow(blob, abvKnown, abv)) return 'na_low';

		if ((/lager|pils|pilsner|helles|kölsch|kolsch|märzen|marzen|bock|dortmunder|cream ale|schwarzbier|munich|vienna lager|rauchbier|smoked lager|festbier|oktoberfest/.test(blob)) && !/ipa|india pale|pale ale/i.test(blob)) {
			return 'lager';
		}

		if (/witbier|hefeweizen|\bwheat\b|weisse|weizen|dunkelweizen|weissbier|\bwit\b/.test(blob)) return 'wheat';

		if (/\bipa\b|dipa|double ipa|triple ipa|neipa|tipa|india pale ale|hazy ipa|west coast ipa|session ipa|new england ipa|black ipa|cold ipa/.test(blob)) return 'ipa';

		if (/pale ale|blonde|blond ale|golden ale|\bmild\b|\besb\b|extra special|english bitter|best bitter|ordinary bitter|cask bitter/.test(blob)) return 'pale';

		if (/saison|dubbel|tripel|quadrupel|\bquad\b|belgian strong|belgian ale|farmhouse|trappist|abbey ale/.test(blob)) return 'belgian';

		if (/brown ale|\bamber\b|red ale|scotch ale|scottish ale|rye ale/.test(blob)) return 'brown_amber';

		if (/porter|stout|milk stout|imperial stout|oatmeal stout|chocolate stout|pastry stout|baltic porter/.test(blob)) return 'porter_stout';

		if (/barleywine|barley wine|old ale|wee heavy|english strong ale/.test(blob)) return 'barleywine';

		if (abvKnown && abv <= 4.5) return 'session';
		if (abvKnown && abv >= 8) return 'strong';
		return 'other';
	}

	var TASTE_MAP_HIGH_ABV = 8;

	function tasteMapUseHighAbvRing(cat, abv) {
		if (isNaN(abv) || abv < TASTE_MAP_HIGH_ABV) return false;
		return cat !== 'na_low' && cat !== 'porter_stout' && cat !== 'barleywine' && cat !== 'strong';
	}

	var TASTE_MAP_LEGEND = [
		{ key: 'na_low', label: 'NA / ≤1.2%' },
		{ key: 'session', label: 'Session' },
		{ key: 'lager', label: 'Lager' },
		{ key: 'wheat', label: 'Wheat' },
		{ key: 'pale', label: 'Pale / bitter' },
		{ key: 'ipa', label: 'IPA' },
		{ key: 'belgian', label: 'Belgian' },
		{ key: 'brown_amber', label: 'Brown / amber' },
		{ key: 'porter_stout', label: 'Porter / stout' },
		{ key: 'barleywine', label: 'Barleywine' },
		{ key: 'sours', label: 'Sour' },
		{ key: 'fruited', label: 'Fruited' },
		{ key: 'strong', label: 'Strong (other)' },
		{ key: 'other', label: 'Other' }
	];

	function buildTasteMapHtml(rated) {
		var pts = [];
		(rated || []).forEach(function (b) {
			var abv = parseFloat(b.beer_abv);
			var r = normaliseUserRatingScoreForStorage(b.rating_score);
			if (r == null || isNaN(abv) || abv < 0) return;
			pts.push({ b: b, abv: abv, r: r });
		});
		if (pts.length < 3) {
			return '<div class="dash-card wide taste-map-card taste-map-card--empty">' +
				'<div class="dash-lbl">Taste map</div>' +
				'<p class="taste-map-empty-msg">Need at least <strong>three</strong> rated check-ins with <strong>ABV</strong> (including 0% NA) to plot your map.</p>' +
				'</div>';
		}

		var abvs = pts.map(function (p) { return p.abv; });
		var rs = pts.map(function (p) { return p.r; });
		var minAbv = Math.min.apply(null, abvs);
		var maxAbv = Math.max.apply(null, abvs);
		var minR = Math.min.apply(null, rs);
		var maxR = Math.max.apply(null, rs);
		var abvSpan = maxAbv - minAbv;
		var abvPad = Math.max(0.35, abvSpan * 0.1);
		minAbv = Math.max(0, minAbv - abvPad);
		maxAbv = maxAbv + abvPad;
		if (maxAbv - minAbv < 0.15) {
			maxAbv = minAbv + 0.15;
		}
		var rPad = 0.2;
		minR = Math.max(0.25, minR - rPad);
		maxR = Math.min(5.25, maxR + rPad);
		if (maxR - minR < 0.35) {
			minR = Math.max(0.25, maxR - 0.5);
		}

		var COLS = 4;
		var ROWS = 3;
		var plotW = 84;
		var plotH = 84;
		var origin = 8;
		var cellW = plotW / COLS;
		var cellH = plotH / ROWS;

		var cells = {};
		pts.forEach(function (p) {
			var abvN = (p.abv - minAbv) / (maxAbv - minAbv);
			var ratN = (p.r - minR) / (maxR - minR);
			var col = Math.min(COLS - 1, Math.floor(abvN * COLS));
			var row = Math.min(ROWS - 1, Math.floor((1 - ratN) * ROWS));
			var key = col + ',' + row;
			if (!cells[key]) {
				cells[key] = { col: col, row: row, count: 0, sum: 0 };
			}
			cells[key].count++;
			cells[key].sum += p.r;
		});

		var bestKey = null;
		var minCountForSpot = pts.length >= 8 ? 2 : 1;
		function pickBestSpot(minC) {
			var bk = null;
			var bs = -1;
			Object.keys(cells).forEach(function (k) {
				var c = cells[k];
				if (c.count < minC) return;
				var avg = c.sum / c.count;
				var score = c.count * avg;
				if (score > bs) {
					bs = score;
					bk = k;
				}
			});
			return bk;
		}
		bestKey = pickBestSpot(minCountForSpot);
		if (bestKey == null && minCountForSpot > 1) {
			bestKey = pickBestSpot(1);
		}

		var spotHtml = '';
		var captionHtml = '';
		if (bestKey != null) {
			var bc = cells[bestKey];
			var sl = origin + bc.col * cellW;
			var st = origin + bc.row * cellH;
			var avgR = bc.sum / bc.count;
			var abvLo = minAbv + (bc.col / COLS) * (maxAbv - minAbv);
			var abvHi = minAbv + ((bc.col + 1) / COLS) * (maxAbv - minAbv);
			spotHtml = '<div class="taste-map-sweet" style="left:' + sl + '%;top:' + st + '%;width:' + cellW + '%;height:' + cellH + '%" aria-hidden="true"></div>';
			captionHtml = '<div class="taste-map-sweet-caption">Sweet spot · ~' + abvLo.toFixed(1) + '–' + abvHi.toFixed(1) + '% ABV · ~' + avgR.toFixed(1) + '★ avg</div>';
		}

		var seenCat = {};
		var seenHighAbvRing = false;
		var dotsHtml = '';
		pts.forEach(function (p) {
			var abvN = (p.abv - minAbv) / (maxAbv - minAbv);
			var ratN = (p.r - minR) / (maxR - minR);
			var h = tasteMapHash(String(p.b.item_id != null ? p.b.item_id : '') + '\t' + (p.b.beer_name || ''));
			var jx = ((h % 7) - 3) * 0.45;
			var jy = ((Math.floor(h / 7) % 7) - 3) * 0.45;
			var left = origin + abvN * plotW + jx;
			var top = origin + (1 - ratN) * plotH + jy;
			left = Math.max(3.5, Math.min(96.5, left));
			top = Math.max(3.5, Math.min(96.5, top));
			var cat = tasteMapStyleCategory(p.b);
			seenCat[cat] = true;
			var highRing = tasteMapUseHighAbvRing(cat, p.abv);
			if (highRing) seenHighAbvRing = true;
			var ariaName = beerDisplayName(p.b);
			dotsHtml +=
				'<button type="button" class="taste-dot taste-dot--' + cat + (highRing ? ' taste-dot--high-abv' : '') + '" ' +
				'style="left:' + left.toFixed(2) + '%;top:' + top.toFixed(2) + '%" ' +
				'data-n="' + encodeURIComponent(p.b.beer_name || '') + '" ' +
				'data-w="' + encodeURIComponent(p.b.brewery_name || '') + '" ' +
				'data-abv="' + p.abv + '" data-r="' + p.r + '" ' +
				'aria-label="' + escapeHtml('Show: ' + ariaName) + '"></button>';
		});

		var legendHtml = '<div class="taste-map-legend">';
		TASTE_MAP_LEGEND.forEach(function (leg) {
			if (!seenCat[leg.key]) return;
			legendHtml +=
				'<span class="taste-legend-item"><span class="taste-legend-swatch taste-legend-swatch--' + leg.key + '"></span>' + leg.label + '</span>';
		});
		if (seenHighAbvRing) {
			legendHtml += '<span class="taste-legend-item taste-legend-item--note"><span class="taste-legend-swatch taste-legend-swatch--ring-demo" aria-hidden="true"></span>8%+ ABV ring</span>';
		}
		legendHtml += '</div>';

		var xMin = minAbv.toFixed(1);
		var xMax = maxAbv.toFixed(1);
		var yMin = minR.toFixed(1);
		var yMax = maxR.toFixed(1);

		return '<div class="dash-card wide taste-map-card">' +
			'<div class="dash-lbl">Taste map</div>' +
			'<p class="taste-map-blurb">Your ratings by ABV (across) and your score (up). Colours = style; bright ring = 8%+ ABV. Tap a dot.</p>' +
			captionHtml +
			'<div class="taste-map-body">' +
			'<div class="taste-map-y-axis" aria-hidden="true">' +
			'<span>' + yMax + '★</span><span>' + yMin + '★</span>' +
			'</div>' +
			'<div class="taste-map-plot" role="img" aria-label="Scatter of journal beers: ABV versus your rating">' +
			'<div class="taste-map-grid-lines" aria-hidden="true"></div>' +
			spotHtml +
			dotsHtml +
			'</div>' +
			'</div>' +
			'<div class="taste-map-x-axis" aria-hidden="true">' +
			'<span>' + xMin + '%</span><span>ABV</span><span>' + xMax + '%</span>' +
			'</div>' +
			legendHtml +
			'<div id="tasteMapDetail" class="taste-map-detail" hidden></div>' +
			'</div>';
	}

	function shelfStackShapeClass(b) {
		var t = (b.beer_type || '').toLowerCase();
		if (/stout|porter|belgian|barleywine/.test(t)) return 'shape-bottle';
		if (/cask|bitter/.test(t)) return 'shape-pint';
		return 'shape-can';
	}

	function shelfLocationGridClass() {
		if (stockLocationFilter === 'fridge') return 'list--shelf-fridge';
		if (stockLocationFilter === 'cupboard') return 'list--shelf-cupboard';
		return 'list--shelf-all';
	}

	function buildShelfTile(b) {
		var div = document.createElement('div');
		div.className = 'item shelf-tile';

		var imgUrl = getImageUrl(b);
		var imgHtml = imgUrl
			? '<img class="shelf-img" src="' + escapeHtml(imgUrl) + '" alt="" loading="lazy">'
			: '<div class="shelf-img shelf-img-placeholder">🍺</div>';

		var vq = visibleQty(b);
		var badgeHtml = vq > 1
			? '<span class="shelf-qty-badge" aria-label="' + vq + ' in stock">×' + vq + '</span>'
			: '';

		var abvStr = b.beer_abv != null && b.beer_abv !== '' ? b.beer_abv + '%' : '';
		var metaParts = [b.brewery_name || '', b.beer_type || ''].filter(Boolean);
		if (abvStr) metaParts.push(abvStr);
		var qty = b.quantity != null && b.quantity > 0 ? Number(b.quantity) : 0;
		var inFridge = b.in_fridge != null ? Number(b.in_fridge) : 0;
		var inCupboard = b.in_cupboard != null ? Number(b.in_cupboard) : Math.max(0, qty - inFridge);
		var qtyStr = qty > 0 ? '×' + qty : '';
		if (!b.stock_location_unspecified && qty > 0) {
			if (inFridge > 0 && inCupboard > 0) qtyStr += ' (' + inFridge + ' fridge, ' + inCupboard + ' cupboard)';
			else if (inFridge > 0) qtyStr += inFridge > 1 ? ' (' + inFridge + ' fridge)' : ' (fridge)';
			else if (inCupboard > 0 && mode === 'stock') qtyStr += inCupboard > 1 ? ' (' + inCupboard + ' cupboard)' : ' (cupboard)';
		}

		var untappdHtml = (b.untappd_url)
			? '<a href="' + escapeHtml(b.untappd_url) + '" class="btn-link btn-untappd" target="_blank" rel="noopener">Untappd</a>'
			: '';

		var stackShape = shelfStackShapeClass(b);
		var mainHtml =
			'<div class="shelf-tile-top shelf-tile-top--swipe">' +
				'<div class="shelf-stack ' + stackShape + '">' +
					'<div class="shelf-img-wrap">' + imgHtml + badgeHtml + '</div>' +
				'</div>' +
				'<div class="shelf-tile-name">' + escapeHtml(b.beer_name || '') + '</div>' +
				'<div class="shelf-tile-expanded">' +
					'<div class="shelf-tile-meta">' + escapeHtml(metaParts.join(' · ')) + '</div>' +
					(qtyStr ? '<div class="shelf-tile-qty">' + escapeHtml(qtyStr) + '</div>' : '') +
					(untappdHtml ? '<div class="shelf-tile-actions">' + untappdHtml + '</div>' : '') +
					'<div class="swipe-hint swipe-hint--shelf">→ / ← swipe</div>' +
				'</div>' +
			'</div>';

		var detailHtml = buildDetailSectionHtml(b);
		div.innerHTML = mainHtml + detailHtml;

		var topEl = div.querySelector('.shelf-tile-top');
		if (mode === 'stock') {
			wirePointerSwipeGesture(topEl, div, {
				forward: function () { return applyForwardSwipeOnBeer(b); },
				backward: function () { return applyBackwardSwipeOnBeer(b); }
			});
		}

		div.addEventListener('click', function (e) {
			if (e.target.closest('a')) return;
			if (div.dataset.swipeCommitted === '1') {
				delete div.dataset.swipeCommitted;
				return;
			}
			var wasExpanded = div.classList.contains('expanded');
			document.querySelectorAll('.item.expanded').forEach(function (el) { el.classList.remove('expanded'); });
			if (!wasExpanded) div.classList.add('expanded');
		});

		return div;
	}

	function render() {
		var list = get('beerList');
		if (!list) return;

		var query = (get('searchInput') && get('searchInput').value || '').trim();
		if (get('clearSearch')) get('clearSearch').style.display = query.length > 0 ? 'flex' : 'none';

		var items;
		var filterTotal;
		if (mode === 'stock' && stockLocationFilter === 'drank') {
			items = filteredDrankEvents();
			filterTotal = recentlyDrank.length;
		} else if (mode === 'stock' && stockLocationFilter === 'archive') {
			items = filteredArchiveEvents();
			filterTotal = drankArchive.length;
		} else {
			items = filteredBeers();
			filterTotal = beers.length;
		}

		if (mode === 'stock') {
			if (stockLocationFilter === 'drank' || stockLocationFilter === 'archive') {
				items.sort(function (a, b) {
					var ka = stockLocationFilter === 'archive'
						? String(a.archived_at || a.consumed_at || '')
						: String(a.consumed_at || '');
					var kb = stockLocationFilter === 'archive'
						? String(b.archived_at || b.consumed_at || '')
						: String(b.consumed_at || '');
					return sortDir * kb.localeCompare(ka);
				});
			} else if (currentSort === 'alpha') {
				items.sort(function (a, b) { return sortDir * (a.beer_name || '').localeCompare(b.beer_name || ''); });
			} else if (currentSort === 'abv') {
				items.sort(function (a, b) { return sortDir * ((parseFloat(b.beer_abv) || 0) - (parseFloat(a.beer_abv) || 0)); });
			} else if (currentSort === 'qty') {
				items.sort(function (a, b) { return sortDir * ((b.quantity || 0) - (a.quantity || 0)); });
			} else if (currentSort === 'rating') {
				items.sort(function (a, b) { return sortDir * (userRatingSortKey(b) - userRatingSortKey(a)); });
			} else if (currentSort === 'date') {
				items.sort(function (a, b) {
					var da = (a.created_at || '').replace(/-/g, '').replace(/\s/g, '');
					var db = (b.created_at || '').replace(/-/g, '').replace(/\s/g, '');
					return sortDir * (db.localeCompare(da));
				});
			} else if (currentSort === 'style') {
				items.sort(function (a, b) {
					var sa = (a.beer_type || '').localeCompare(b.beer_type || '');
					return sortDir * (sa !== 0 ? sa : (a.beer_name || '').localeCompare(b.beer_name || ''));
				});
			}
		} else {
			items = sortJournalItems(items);
			filterTotal = beers.length;
		}

		updateFilterCount(items.length, filterTotal);
		renderJournalMore(mode === 'ratings' ? items.length : 0);
		if (mode === 'ratings') syncBreweryRankRows();

		list.innerHTML = '';

		if (mode === 'stock' && stockLayout === 'shelf' && stockLocationFilter !== 'drank' && stockLocationFilter !== 'archive') {
			list.className = 'list list--shelf-container';
			var colsClass = (stockLocationFilter === 'fridge' || stockLocationFilter === 'cupboard')
				? 'list--shelf-cols-4'
				: 'list--shelf-cols-6';
			var locClass = shelfLocationGridClass();
			var session = [];
			var core = [];
			var sours = [];
			var fruited = [];
			var dark = [];
			var strong = [];
			items.forEach(function (b) {
				var cat = categorizeShelfBeer(b);
				if (cat === 'session') session.push(b);
				else if (cat === 'core') core.push(b);
				else if (cat === 'sours') sours.push(b);
				else if (cat === 'fruited') fruited.push(b);
				else if (cat === 'dark') dark.push(b);
				else if (cat === 'strong') strong.push(b);
				else core.push(b);
			});
			var sections = [
				{ arr: session, title: 'Session & Light' },
				{ arr: core, title: 'Core IPAs & Pales' },
				{ arr: sours, title: 'Sours' },
				{ arr: fruited, title: 'Fruited' },
				{ arr: dark, title: 'Dark' },
				{ arr: strong, title: 'The Strong Stuff' }
			];
			var shelfFrag = document.createDocumentFragment();
			sections.forEach(function (sec) {
				if (!sec.arr.length) return;
				var elSection = document.createElement('section');
				elSection.className = 'shelf-section';
				elSection.setAttribute('aria-label', sec.title);
				var divider = document.createElement('div');
				divider.className = 'shelf-divider';
				divider.textContent = sec.title;
				elSection.appendChild(divider);
				var grid = document.createElement('div');
				grid.className = 'list list--shelf ' + colsClass + ' ' + locClass;
				sec.arr.forEach(function (b) { grid.appendChild(buildShelfTile(b)); });
				elSection.appendChild(grid);
				shelfFrag.appendChild(elSection);
			});
			list.appendChild(shelfFrag);
			return;
		}

		list.className = mode === 'ratings' ? 'list list--journal' : 'list';
		var frag = document.createDocumentFragment();
		if (mode === 'stock') {
			if (stockLocationFilter === 'drank') {
				items.forEach(function (e) { frag.appendChild(buildDrankCard(e)); });
			} else if (stockLocationFilter === 'archive') {
				items.forEach(function (e) { frag.appendChild(buildArchiveCard(e)); });
			} else {
				items.forEach(function (b) { frag.appendChild(buildCard(b)); });
			}
		} else {
			var shownItems = (!journalShowAll && items.length > JOURNAL_LIST_CAP) ? items.slice(0, JOURNAL_LIST_CAP) : items;
			shownItems.forEach(function (b) { frag.appendChild(buildJournalCard(b)); });
		}
		list.appendChild(frag);
	}

	/** "Show all / Show fewer" under the journal list, which shows JOURNAL_LIST_CAP beers until expanded. */
	function renderJournalMore(total) {
		var el = get('journalMore');
		if (!el) return;
		var show = mode === 'ratings' && total > JOURNAL_LIST_CAP;
		el.classList.toggle('hidden', !show);
		el.innerHTML = show
			? '<button type="button" class="journal-more-btn">' + (journalShowAll ? 'Show fewer ↑' : 'Show all ' + total + ' ↓') + '</button>'
			: '';
	}

	/** Highlight brewery-ranking rows that match the brewery filter, in place (keeps the lists' scroll position). */
	function syncBreweryRankRows() {
		var el = get('journalDashboard');
		if (!el) return;
		el.querySelectorAll('.palate-rank-row[data-brewery]').forEach(function (row) {
			var name = '';
			try { name = decodeURIComponent(row.getAttribute('data-brewery') || ''); } catch (e) {}
			var on = activeFilters.brewery.has(name);
			row.classList.toggle('palate-rank-row--active', on);
			row.setAttribute('aria-pressed', on ? 'true' : 'false');
		});
	}

	function onChipClick(filterKey, value) {
		var s = activeFilters[filterKey];
		if (s.has(value)) s.delete(value); else s.add(value);
		refreshChips();
		render();
	}

	function wireChipRow(containerId, filterKey) {
		var container = get(containerId);
		if (!container) return;
		container.addEventListener('click', function (e) {
			var chip = e.target.closest('.chip');
			if (chip) onChipClick(filterKey, chip.dataset.value);
		});
	}

	function clearInput() {
		var el = get('searchInput');
		if (el) { el.value = ''; render(); }
	}

	var SORT_LABELS = { alpha: '🔤', abv: '% ABV', qty: '📦 Qty', style: '🍺 Style', rating: '★ Rating', date: '📅 Date' };
	function updateSortButtonLabels() {
		var ids = ['sortAlpha', 'sortAbv', 'sortQty', 'sortRating', 'sortDate', 'sortStyle'];
		var keyMap = { sortAlpha: 'alpha', sortAbv: 'abv', sortQty: 'qty', sortStyle: 'style', sortRating: 'rating', sortDate: 'date' };
		ids.forEach(function (id) {
			var btn = get(id);
			if (!btn) return;
			var key = keyMap[id];
			btn.className = (currentSort === key ? 'sort-btn active' : 'sort-btn') + (btn.classList.contains('sort-btn-ratings') ? ' sort-btn-ratings' : '');
			// Keep button label stable (no up/down arrows).
			btn.textContent = SORT_LABELS[key];
		});
	}

	function triggerSortPulse(btn) {
		if (!btn) return;
		btn.classList.remove('sort-btn--pulse');
		// Force reflow so the animation restarts on rapid taps.
		void btn.offsetWidth;
		btn.classList.add('sort-btn--pulse');
		setTimeout(function () { btn.classList.remove('sort-btn--pulse'); }, 260);
	}

	function setSort(s, pulseEl) {
		if (currentSort === s) {
			sortDir = sortDir * -1;
		} else {
			currentSort = s;
			sortDir = 1;
		}
		updateSortButtonLabels();
		triggerSortPulse(pulseEl);
		render();
	}

	function updateModeUI() {
		var tabStock = get('tabStock');
		var tabRatings = get('tabRatings');
		if (tabStock) { tabStock.classList.toggle('active', mode === 'stock'); tabStock.setAttribute('aria-selected', mode === 'stock'); }
		if (tabRatings) { tabRatings.classList.toggle('active', mode === 'ratings'); tabRatings.setAttribute('aria-selected', mode === 'ratings'); }

		if (mode === 'stock' && (currentSort === 'rating' || currentSort === 'date')) currentSort = 'alpha';
		if (mode === 'ratings' && (currentSort === 'abv' || currentSort === 'qty')) currentSort = 'alpha';

		updateSortButtonLabels();

		var stockSortRow = get('stockSortRow');
		if (stockSortRow) stockSortRow.classList.toggle('hidden', mode !== 'stock');

		var jDash = get('journalDashboard');
		var jPalate = get('journalPalate');
		var jArea = get('journalSortArea');
		var showJournalChrome = mode === 'ratings' && ratingBeers.length > 0;
		if (jDash) jDash.classList.toggle('hidden', !showJournalChrome);
		if (jPalate) jPalate.classList.toggle('hidden', !showJournalChrome);
		if (jArea) jArea.classList.toggle('hidden', !showJournalChrome);
		if (showJournalChrome) {
			renderJournalSortBar();
			renderDashboard();
		} else if (mode === 'ratings' && jDash) {
			jDash.innerHTML = '';
			if (jPalate) jPalate.innerHTML = '';
		}

		var sortAbv = get('sortAbv');
		var sortQty = get('sortQty');
		var sortRating = get('sortRating');
		var sortDate = get('sortDate');
		var historyStock = mode === 'stock' && (stockLocationFilter === 'drank' || stockLocationFilter === 'archive');
		if (sortAbv) sortAbv.classList.toggle('hidden', mode === 'ratings' || historyStock);
		if (sortQty) sortQty.classList.toggle('hidden', mode === 'ratings' || historyStock);
		if (sortRating) sortRating.classList.toggle('hidden', mode === 'stock');
		if (sortDate) sortDate.classList.toggle('hidden', mode === 'stock');

		var listEl = get('beerList');
		var loadStockPrompt = get('loadStockPrompt');
		var loadRatingsPrompt = get('loadRatingsPrompt');
		if (mode === 'stock') {
			if (loadStockPrompt) loadStockPrompt.classList.toggle('hidden', stockBeers.length > 0);
			if (loadRatingsPrompt) loadRatingsPrompt.classList.add('hidden');
			var stockListEmpty = stockBeers.length === 0 && recentlyDrank.length === 0 && drankArchive.length === 0;
			if (listEl) listEl.classList.toggle('hidden', stockListEmpty);
			var locationRow = get('locationRow');
			if (locationRow) locationRow.classList.toggle('hidden', stockBeers.length === 0 && recentlyDrank.length === 0 && drankArchive.length === 0);
			['locAll', 'locCupboard', 'locFridge', 'locDrank', 'locArchive'].forEach(function (id) {
				var btn = get(id);
				if (!btn) return;
				var loc = btn.getAttribute('data-loc');
				btn.classList.toggle('active', stockLocationFilter === loc);
			});
		} else {
			if (loadRatingsPrompt) loadRatingsPrompt.classList.toggle('hidden', ratingBeers.length > 0);
			if (loadStockPrompt) loadStockPrompt.classList.add('hidden');
			if (listEl) listEl.classList.toggle('hidden', ratingBeers.length === 0);
			var locationRow = get('locationRow');
			if (locationRow) locationRow.classList.add('hidden');
		}

		syncStockLayoutControls();
		updateStats();
		render();
	}

	function syncStockLayoutControls() {
		var row = get('stockLayoutRow');
		var show = mode === 'stock' && stockBeers.length > 0 && stockLocationFilter !== 'drank' && stockLocationFilter !== 'archive';
		if (row) row.classList.toggle('hidden', !show);

		var layoutList = get('layoutList');
		var layoutShelf = get('layoutShelf');
		if (layoutList) {
			layoutList.classList.toggle('active', stockLayout === 'list');
			layoutList.setAttribute('aria-selected', stockLayout === 'list' ? 'true' : 'false');
		}
		if (layoutShelf) {
			layoutShelf.classList.toggle('active', stockLayout === 'shelf');
			layoutShelf.setAttribute('aria-selected', stockLayout === 'shelf' ? 'true' : 'false');
		}
	}

	function setStockLayout(layout) {
		if (layout !== 'list' && layout !== 'shelf') return;
		stockLayout = layout;
		try {
			if (typeof localStorage !== 'undefined') localStorage.setItem('mybeer_stock_layout', layout);
		} catch (e) {}
		syncStockLayoutControls();
		render();
	}

	function clearAllFilters() {
		activeFilters.style.clear();
		activeFilters.brewery.clear();
		refreshChips();
		render();
	}

	function normaliseBeers(arr) {
		if (!Array.isArray(arr)) return [];
		return arr.map(function (b) {
			if (!b || typeof b !== 'object') return null;
			var qty = typeof b.quantity === 'number' ? b.quantity : (parseInt(b.quantity, 10) || 0);
			var hasFridgeKey = Object.prototype.hasOwnProperty.call(b, 'in_fridge');
			var hasCupboardKey = Object.prototype.hasOwnProperty.call(b, 'in_cupboard');
			var infNum = hasFridgeKey ? (typeof b.in_fridge === 'number' ? b.in_fridge : (b.in_fridge === true ? 1 : 0)) : 0;
			var incNum = hasCupboardKey
				? (typeof b.in_cupboard === 'number' ? b.in_cupboard : (b.in_cupboard === true ? 1 : Math.max(0, qty - infNum)))
				: Math.max(0, qty - infNum);
			var stock_location_unspecified;
			if (b.stock_location_unspecified === true) {
				stock_location_unspecified = true;
			} else if (b.stock_location_unspecified === false) {
				stock_location_unspecified = false;
			} else if (!hasFridgeKey && !hasCupboardKey) {
				stock_location_unspecified = true;
			} else {
				var legacyImplicitCupboard = hasFridgeKey && hasCupboardKey && infNum === 0 && qty > 0 && incNum === qty;
				var onlyFridgeZero = hasFridgeKey && !hasCupboardKey && infNum === 0 && qty > 0;
				stock_location_unspecified = legacyImplicitCupboard || onlyFridgeZero;
			}
			var inFridge;
			var inCupboard;
			if (stock_location_unspecified) {
				inFridge = null;
				inCupboard = null;
			} else {
				if (hasFridgeKey) {
					inFridge = typeof b.in_fridge === 'number' ? b.in_fridge : (b.in_fridge === true ? 1 : 0);
				} else {
					inFridge = 0;
				}
				if (hasCupboardKey) {
					inCupboard = typeof b.in_cupboard === 'number' ? b.in_cupboard : (b.in_cupboard === true ? 1 : Math.max(0, qty - inFridge));
				} else {
					inCupboard = Math.max(0, qty - inFridge);
				}
			}
			return {
				beer_name: b.beer_name != null ? String(b.beer_name) : '',
				brewery_name: b.brewery_name != null ? String(b.brewery_name) : '',
				beer_type: b.beer_type != null ? String(b.beer_type) : '',
				beer_abv: b.beer_abv,
				beer_ibu: normaliseBeerIbuForStorage(b.beer_ibu),
				item_id: b.item_id,
				quantity: qty,
				image_url: b.image_url || null,
				image_source: b.image_source || null,
				untappd_url: b.untappd_url || (b.item_id ? 'https://untappd.com/beer/' + b.item_id : null),
				notes: b.notes || null,
				best_by_date_iso: b.best_by_date_iso || null,
				in_fridge: inFridge,
				in_cupboard: inCupboard,
				stock_location_unspecified: stock_location_unspecified,
				rating_score: normaliseUserRatingScoreForStorage(b.rating_score),
				created_at: b.created_at || null,
				comment: b.comment || null
			};
		}).filter(Boolean);
	}

	function mergeImportedStockWithDevice(normalisedRows) {
		var out = [];
		(normalisedRows || []).forEach(function (b) {
			if (!b || b.item_id == null) return;
			var row = {
				beer_name: b.beer_name,
				brewery_name: b.brewery_name,
				beer_type: b.beer_type,
				beer_abv: b.beer_abv,
				beer_ibu: b.beer_ibu,
				item_id: Number(b.item_id),
				image_url: b.image_url,
				image_source: b.image_source,
				untappd_url: b.untappd_url,
				notes: b.notes,
				best_by_date_iso: b.best_by_date_iso,
				rating_score: b.rating_score,
				created_at: b.created_at,
				comment: b.comment
			};
			row.stock_location_unspecified = !!b.stock_location_unspecified;
			if (row.stock_location_unspecified) {
				row.in_fridge = null;
				row.in_cupboard = null;
				row.quantity = typeof b.quantity === 'number' ? b.quantity : (parseInt(b.quantity, 10) || 0);
			} else {
				row.in_fridge = b.in_fridge != null ? Number(b.in_fridge) : 0;
				row.in_cupboard = b.in_cupboard != null ? Number(b.in_cupboard) : 0;
				row.quantity = row.in_fridge + row.in_cupboard;
			}
			if (row.quantity > 0) out.push(row);
		});
		return out;
	}

	function findStockBeerIndex(itemId) {
		var id = Number(itemId);
		for (var i = 0; i < stockBeers.length; i++) {
			if (Number(stockBeers[i].item_id) === id) return i;
		}
		return -1;
	}

	function ensureExplicitLocationForSwipe(b) {
		if (!b.stock_location_unspecified) return;
		var q = typeof b.quantity === 'number' ? b.quantity : (parseInt(b.quantity, 10) || 0);
		b.stock_location_unspecified = false;
		b.in_fridge = 0;
		b.in_cupboard = q;
		b.quantity = q;
	}

	function appendDrinkEventFromBeer(b) {
		recentlyDrank.push({
			id: 'd-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9),
			item_id: b.item_id,
			beer_name: b.beer_name || '',
			brewery_name: b.brewery_name || '',
			beer_type: b.beer_type || '',
			beer_abv: b.beer_abv,
			image_url: b.image_url || null,
			consumed_at: new Date().toISOString(),
			quantity_consumed: 1
		});
	}

	function applyForwardSwipeOnBeer(b) {
		ensureExplicitLocationForSwipe(b);
		var inf = Number(b.in_fridge) || 0;
		var inc = Number(b.in_cupboard) || 0;
		var label = beerDisplayName(b);
		if (inc > 0) {
			b.in_cupboard = inc - 1;
			b.in_fridge = inf + 1;
			b.quantity = b.in_fridge + b.in_cupboard;
			showStockActionToast(label + ' moved to the fridge');
			return true;
		}
		if (inf > 0) {
			b.in_fridge = inf - 1;
			b.quantity = b.in_fridge + b.in_cupboard;
			appendDrinkEventFromBeer(b);
			if (b.quantity <= 0) {
				var idx = findStockBeerIndex(b.item_id);
				if (idx >= 0) stockBeers.splice(idx, 1);
			}
			showStockActionToast(label + ' marked as drank');
			return true;
		}
		return false;
	}

	function applyBackwardSwipeOnBeer(b) {
		ensureExplicitLocationForSwipe(b);
		var inf = Number(b.in_fridge) || 0;
		var inc = Number(b.in_cupboard) || 0;
		if (inf <= 0) return false;
		b.in_fridge = inf - 1;
		b.in_cupboard = inc + 1;
		b.quantity = b.in_fridge + b.in_cupboard;
		showStockActionToast(beerDisplayName(b) + ' moved to the cupboard');
		return true;
	}

	function findRecentlyDrankIndex(entry) {
		if (!entry) return -1;
		var i;
		if (entry.id != null) {
			for (i = 0; i < recentlyDrank.length; i++) {
				if (recentlyDrank[i].id === entry.id) return i;
			}
		}
		var itemId = entry.item_id != null ? Number(entry.item_id) : null;
		var at = entry.consumed_at != null ? String(entry.consumed_at) : '';
		for (i = 0; i < recentlyDrank.length; i++) {
			var e = recentlyDrank[i];
			if (at && String(e.consumed_at || '') === at && (itemId == null || Number(e.item_id) === itemId)) return i;
		}
		return -1;
	}

	function findArchiveIndex(entry) {
		if (!entry) return -1;
		var i;
		if (entry.id != null) {
			for (i = 0; i < drankArchive.length; i++) {
				if (drankArchive[i].id === entry.id) return i;
			}
		}
		var itemId = entry.item_id != null ? Number(entry.item_id) : null;
		var at = entry.consumed_at != null ? String(entry.consumed_at) : '';
		var archAt = entry.archived_at != null ? String(entry.archived_at) : '';
		for (i = 0; i < drankArchive.length; i++) {
			var e = drankArchive[i];
			if (!at || String(e.consumed_at || '') !== at) continue;
			if (itemId != null && Number(e.item_id) !== itemId) continue;
			if (archAt && String(e.archived_at || '') !== archAt) continue;
			return i;
		}
		return -1;
	}

	function moveDrankEntryToArchive(entry) {
		var idx = findRecentlyDrankIndex(entry);
		if (idx < 0) return false;
		var row = recentlyDrank.splice(idx, 1)[0];
		row.archived_at = new Date().toISOString();
		drankArchive.unshift(row);
		showStockActionToast(beerDisplayName(row) + ' moved to archive');
		return true;
	}

	function restoreArchiveEntryToDrank(entry) {
		var idx = findArchiveIndex(entry);
		if (idx < 0) return false;
		var row = drankArchive.splice(idx, 1)[0];
		delete row.archived_at;
		recentlyDrank.unshift(row);
		showStockActionToast(beerDisplayName(row) + ' back in Drank');
		return true;
	}

	function restoreOneToFridgeFromDrankEntry(entry) {
		var id = entry.item_id != null ? Number(entry.item_id) : null;
		if (id == null || isNaN(id)) return false;
		var idx = findStockBeerIndex(id);
		var row;
		if (idx >= 0) {
			row = stockBeers[idx];
		} else {
			row = {
				item_id: id,
				beer_name: entry.beer_name || '',
				brewery_name: entry.brewery_name || '',
				beer_type: entry.beer_type || '',
				beer_abv: entry.beer_abv,
				beer_ibu: null,
				image_url: entry.image_url || null,
				image_source: null,
				untappd_url: 'https://untappd.com/beer/' + id,
				notes: null,
				best_by_date_iso: null,
				rating_score: null,
				created_at: null,
				comment: null,
				stock_location_unspecified: false,
				in_fridge: 0,
				in_cupboard: 0,
				quantity: 0
			};
			stockBeers.push(row);
		}
		ensureExplicitLocationForSwipe(row);
		row.in_fridge = (Number(row.in_fridge) || 0) + 1;
		row.in_cupboard = Number(row.in_cupboard) || 0;
		row.quantity = row.in_fridge + row.in_cupboard;
		row.stock_location_unspecified = false;
		showStockActionToast(beerDisplayName(entry) + ' back in the fridge (+1)');
		return true;
	}

	function wirePointerSwipeGesture(targetEl, rootEl, handlers) {
		var startX;
		var startY;
		var pid;
		var tracking = false;
		targetEl.style.touchAction = 'pan-y';
		targetEl.addEventListener('pointerdown', function (e) {
			if (e.target.closest('a')) return;
			tracking = true;
			startX = e.clientX;
			startY = e.clientY;
			pid = e.pointerId;
			try { targetEl.setPointerCapture(e.pointerId); } catch (err) {}
		});
		targetEl.addEventListener('pointercancel', function () { tracking = false; });
		targetEl.addEventListener('pointerup', function (e) {
			if (!tracking || e.pointerId !== pid) return;
			tracking = false;
			try { targetEl.releasePointerCapture(pid); } catch (err) {}
			var dx = e.clientX - startX;
			var dy = e.clientY - startY;
			if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dy) > Math.abs(dx)) return;
			var acted = false;
			if (dx > 0 && handlers.forward) acted = !!handlers.forward();
			else if (dx < 0 && handlers.backward) acted = !!handlers.backward();
			if (acted) {
				if (rootEl && rootEl.dataset) rootEl.dataset.swipeCommitted = '1';
				saveToStorage();
				render();
			}
		});
	}

	function isPreNormalisedRatings(arr) {
		if (!Array.isArray(arr) || !arr.length) return false;
		var first = arr[0];
		return first && (first.item_id != null || first.bid != null) && (first.rating_score != null || first.created_at != null);
	}

	function normalisePreNormalisedRatings(arr) {
		if (!Array.isArray(arr)) return [];
		return arr.map(function (b) {
			if (!b || typeof b !== 'object') return null;
			var itemId = b.item_id != null ? b.item_id : b.bid;
			return {
				beer_name: b.beer_name != null ? String(b.beer_name) : '',
				brewery_name: b.brewery_name != null ? String(b.brewery_name) : '',
				beer_type: b.beer_type != null ? String(b.beer_type) : '',
				beer_abv: b.beer_abv,
				beer_ibu: normaliseBeerIbuForStorage(b.beer_ibu),
				item_id: itemId,
				quantity: 0,
				image_url: b.image_url || null,
				image_source: b.image_source || null,
				untappd_url: b.untappd_url || (itemId ? 'https://untappd.com/beer/' + itemId : null),
				notes: b.notes || null,
				best_by_date_iso: b.best_by_date_iso || null,
				rating_score: normaliseUserRatingScoreForStorage(b.rating_score),
				created_at: b.created_at || null,
				comment: b.comment || null,
				untappd_global_rating: parseOptionalRating(b.untappd_global_rating != null ? b.untappd_global_rating : (b.beer_rating_score != null ? b.beer_rating_score : b.global_rating_score))
			};
		}).filter(Boolean);
	}

	function normaliseRatingsFromUntappd(arr) {
		if (!Array.isArray(arr) || arr.length === 0) return [];
		var byBid = {};
		arr.forEach(function (c) {
			if (!c || typeof c !== 'object') return;
			var bid = c.bid != null ? c.bid : (function () { var m = (c.beer_url || '').match(/\/beer\/(\d+)/); return m ? parseInt(m[1], 10) : null; })();
			if (bid == null) return;
			var existing = byBid[bid];
			var created = (c.created_at || '').replace(/-/g, '').replace(/\s/g, '');
			if (!existing || created > (existing.created_at || '').replace(/-/g, '').replace(/\s/g, '')) {
				byBid[bid] = {
					beer_name: c.beer_name != null ? String(c.beer_name) : '',
					brewery_name: c.brewery_name != null ? String(c.brewery_name) : '',
					beer_type: c.beer_type != null ? String(c.beer_type) : '',
					beer_abv: c.beer_abv,
					beer_ibu: normaliseBeerIbuForStorage(c.beer_ibu),
					item_id: bid,
					quantity: 0,
					image_url: c.photo_url || null,
					image_source: c.photo_url ? 'checkin_photo' : null,
					untappd_url: c.beer_url || 'https://untappd.com/beer/' + bid,
					notes: null,
					best_by_date_iso: null,
					rating_score: normaliseUserRatingScoreForStorage(c.rating_score),
					created_at: c.created_at || null,
					comment: c.comment || null,
					untappd_global_rating: globalRatingFromCheckin(c)
				};
			}
		});
		return Object.keys(byBid).map(function (k) { return byBid[k]; });
	}

	function parsePayload(parsed) {
		if (Array.isArray(parsed)) return parsed;
		if (parsed && typeof parsed === 'object') {
			if (Array.isArray(parsed.beers)) return parsed.beers;
			if (Array.isArray(parsed.data)) return parsed.data;
		}
		return null;
	}

	function saveToStorage() {
		try {
			if (typeof localStorage === 'undefined') return;
			localStorage.setItem('mybeer_stock', JSON.stringify(stockBeers));
			localStorage.setItem('mybeer_ratings', JSON.stringify(ratingBeers));
			localStorage.setItem('mybeer_recently_drank', JSON.stringify(recentlyDrank));
			localStorage.setItem('mybeer_drank_archive', JSON.stringify(drankArchive));
		} catch (e) {}
	}

	function loadRecentlyDrankFromStorage() {
		try {
			if (typeof localStorage === 'undefined') return;
			var rd = localStorage.getItem('mybeer_recently_drank');
			if (!rd) return;
			var parsed = JSON.parse(rd);
			if (!Array.isArray(parsed)) return;
			recentlyDrank = parsed.filter(function (e) {
				return e && typeof e === 'object' && e.consumed_at != null;
			});
		} catch (e) {}
	}

	function loadDrankArchiveFromStorage() {
		try {
			if (typeof localStorage === 'undefined') return;
			var raw = localStorage.getItem('mybeer_drank_archive');
			if (!raw) return;
			var parsed = JSON.parse(raw);
			if (!Array.isArray(parsed)) return;
			drankArchive = parsed.filter(function (e) {
				return e && typeof e === 'object' && e.consumed_at != null;
			});
		} catch (e) {}
	}

	function applyStockData(normalised) {
		loadRecentlyDrankFromStorage();
		loadDrankArchiveFromStorage();
		stockBeers = mergeImportedStockWithDevice(normalised);
		mode = 'stock';
		setBeersFromMode();
		updateStats();
		refreshChips();
		updateModeUI();
		saveToStorage();
		if (!inited) { init(); inited = true; }
	}

	function applyRatingsData(normalised) {
		loadRecentlyDrankFromStorage();
		loadDrankArchiveFromStorage();
		ratingBeers = normalised;
		mode = 'ratings';
		setBeersFromMode();
		updateStats();
		refreshChips();
		updateModeUI();
		saveToStorage();
		if (!inited) { init(); inited = true; }
	}

	function showLanding() {
		var landing = get('landing');
		var appContent = get('appContent');
		if (landing) landing.classList.remove('hidden');
		if (appContent) appContent.classList.add('hidden');
	}

	function showMainUI() {
		var landing = get('landing');
		var appContent = get('appContent');
		if (landing) landing.classList.add('hidden');
		if (appContent) appContent.classList.remove('hidden');
	}

	function loadStockFile(file, onSuccess, onError) {
		var reader = new FileReader();
		reader.onerror = function () { onError('Could not read the file.'); };
		reader.onload = function () {
			try {
				var raw = String(reader.result || '[]').trim().replace(/^\uFEFF/, '');
				raw = raw.replace(/,\s*\]\s*$/, ']').replace(/,\s*\}\s*$/, '}');
				if (!raw) { onError('The file is empty.'); return; }
				var parsed = JSON.parse(raw);
				var arr = parsePayload(parsed);
				if (!arr || arr.length === 0) { onError('No beer list found.'); return; }
				onSuccess(normaliseBeers(arr));
			} catch (e) { onError('Not valid JSON: ' + (e && e.message ? e.message : String(e))); }
		};
		reader.readAsText(file);
	}

	function loadRatingsFile(file, onSuccess, onError) {
		var reader = new FileReader();
		reader.onerror = function () { onError('Could not read the file.'); };
		reader.onload = function () {
			try {
				var raw = String(reader.result || '[]').trim().replace(/^\uFEFF/, '');
				raw = raw.replace(/,\s*\]\s*$/, ']').replace(/,\s*\}\s*$/, '}');
				if (!raw) { onError('The file is empty.'); return; }
				var parsed = JSON.parse(raw);
				var arr = Array.isArray(parsed) ? parsed : (parsed.data || parsed.checkins || []);
				if (!arr.length) { onError('No check-ins found. Use an Untappd export (array of check-ins with bid, rating_score).'); return; }
				onSuccess(isPreNormalisedRatings(arr) ? normalisePreNormalisedRatings(arr) : normaliseRatingsFromUntappd(arr));
			} catch (e) { onError('Not valid JSON: ' + (e && e.message ? e.message : String(e))); }
		};
		reader.readAsText(file);
	}

	var pickersWired = false;

	function wireLandingAndPickers() {
		if (pickersWired) return;
		pickersWired = true;
		var btnStock = get('btnLoadStock');
		var btnRatings = get('btnLoadRatings');
		var stockInput = get('stockFileInput');
		var ratingsInput = get('ratingsFileInput');
		if (btnStock && stockInput) {
			btnStock.addEventListener('click', function () { stockInput.click(); });
			stockInput.addEventListener('change', function () {
				var file = stockInput.files && stockInput.files[0];
				if (!file) return;
				btnStock.textContent = 'Loading…';
				btnStock.disabled = true;
				loadStockFile(file, function (normalised) {
					showMainUI();
					applyStockData(normalised);
					stockInput.value = '';
					if (btnStock) { btnStock.textContent = 'Load stock'; btnStock.disabled = false; }
				}, function (msg) {
					alert(msg);
					stockInput.value = '';
					if (btnStock) { btnStock.textContent = 'Load stock'; btnStock.disabled = false; }
				});
			});
		}
		if (btnRatings && ratingsInput) {
			btnRatings.addEventListener('click', function () { ratingsInput.click(); });
			ratingsInput.addEventListener('change', function () {
				var file = ratingsInput.files && ratingsInput.files[0];
				if (!file) return;
				btnRatings.textContent = 'Loading…';
				btnRatings.disabled = true;
				loadRatingsFile(file, function (normalised) {
					showMainUI();
					applyRatingsData(normalised);
					ratingsInput.value = '';
					if (btnRatings) { btnRatings.textContent = 'Load ratings'; btnRatings.disabled = false; }
				}, function (msg) {
					alert(msg);
					ratingsInput.value = '';
					if (btnRatings) { btnRatings.textContent = 'Load ratings'; btnRatings.disabled = false; }
				});
			});
		}
	}

	function init() {
		var searchInput = get('searchInput');
		if (searchInput) searchInput.addEventListener('input', render);

		if (get('clearSearch')) get('clearSearch').addEventListener('click', clearInput);
		if (get('sortAlpha')) get('sortAlpha').addEventListener('click', function () { setSort('alpha', this); });
		if (get('sortAbv')) get('sortAbv').addEventListener('click', function () { setSort('abv', this); });
		if (get('sortQty')) get('sortQty').addEventListener('click', function () { setSort('qty', this); });
		if (get('sortRating')) get('sortRating').addEventListener('click', function () { setSort('rating', this); });
		if (get('sortDate')) get('sortDate').addEventListener('click', function () { setSort('date', this); });
		if (get('sortStyle')) get('sortStyle').addEventListener('click', function () { setSort('style', this); });
		if (get('filterToggle')) get('filterToggle').addEventListener('click', function () { setFilterOpen(!filterOpen); });
		if (get('filterDone')) get('filterDone').addEventListener('click', function () { setFilterOpen(false); });
		if (get('filterClearAll')) get('filterClearAll').addEventListener('click', clearAllFilters);

		var tabStock = get('tabStock');
		var tabRatings = get('tabRatings');
		if (tabStock) tabStock.addEventListener('click', function () { mode = 'stock'; setBeersFromMode(); updateModeUI(); });
		if (tabRatings) tabRatings.addEventListener('click', function () { mode = 'ratings'; setBeersFromMode(); updateModeUI(); });

		var btnLoadStockInApp = get('btnLoadStockInApp');
		var btnLoadRatingsInApp = get('btnLoadRatingsInApp');
		if (btnLoadStockInApp && get('stockFileInput')) btnLoadStockInApp.addEventListener('click', function () { get('stockFileInput').click(); });
		if (btnLoadRatingsInApp && get('ratingsFileInput')) btnLoadRatingsInApp.addEventListener('click', function () { get('ratingsFileInput').click(); });

		['locAll', 'locCupboard', 'locFridge', 'locDrank', 'locArchive'].forEach(function (id) {
			var btn = get(id);
			if (!btn) return;
			btn.addEventListener('click', function () {
				stockLocationFilter = btn.getAttribute('data-loc') || 'all';
				updateModeUI();
			});
		});

		var pills = get('activeFilterPills');
		if (pills) {
			pills.addEventListener('click', function (e) {
				var pill = e.target.closest('.filter-pill');
				if (!pill) return;
				var key = pill.getAttribute('data-filter-key');
				var val = '';
				try { val = decodeURIComponent(pill.getAttribute('data-value') || ''); } catch (e1) {}
				if (activeFilters[key]) activeFilters[key].delete(val);
				refreshChips();
				render();
			});
		}

		var btnUpload = get('btnUpload');
		if (btnUpload) btnUpload.addEventListener('click', function () { showLanding(); });

		if (get('layoutList')) get('layoutList').addEventListener('click', function () { setStockLayout('list'); });
		if (get('layoutShelf')) get('layoutShelf').addEventListener('click', function () { setStockLayout('shelf'); });

		wireChipRow('chipsStyle', 'style');
		wireChipRow('chipsBrewery', 'brewery');

		var jDash = get('journalDashboard');
		if (jDash) {
			jDash.addEventListener('click', function (e) {
				var row = e.target.closest('.palate-rank-row[data-brewery]');
				if (!row) return;
				var name = '';
				try { name = decodeURIComponent(row.getAttribute('data-brewery') || ''); } catch (e1) {}
				if (!name) return;
				if (activeFilters.brewery.has(name)) activeFilters.brewery.delete(name);
				else activeFilters.brewery.add(name);
				journalShowAll = false;
				refreshChips();
				render();
			});
		}

		var jMore = get('journalMore');
		if (jMore) {
			jMore.addEventListener('click', function (e) {
				if (!e.target.closest('.journal-more-btn')) return;
				var collapsing = journalShowAll;
				journalShowAll = !journalShowAll;
				render();
				if (collapsing) jMore.scrollIntoView({ block: 'center' });
			});
		}

		var jPalate = get('journalPalate');
		if (jPalate && !journalTasteMapWired) {
			journalTasteMapWired = true;
			jPalate.addEventListener('click', function (e) {
				if (e.target.closest('#palateToggle')) {
					journalPalateOpen = !journalPalateOpen;
					saveJournalViewPrefs();
					renderPalate(ratingBeers.length ? computeStats(ratingBeers) : null);
					return;
				}
				var detail = jPalate.querySelector('#tasteMapDetail');
				if (!detail) return;
				var btn = e.target.closest('.taste-dot');
				if (btn) {
					e.preventDefault();
					var n = '';
					var w = '';
					try { n = decodeURIComponent(btn.getAttribute('data-n') || ''); } catch (e1) {}
					try { w = decodeURIComponent(btn.getAttribute('data-w') || ''); } catch (e2) {}
					var abv = btn.getAttribute('data-abv') || '';
					var r = btn.getAttribute('data-r') || '';
					detail.innerHTML =
						'<div class="taste-map-detail-name">' + escapeHtml(n) + '</div>' +
						'<div class="taste-map-detail-meta">' + escapeHtml(w) +
						(abv !== '' ? ' · ' + escapeHtml(String(abv)) + '% ABV' : '') +
						' · ★ ' + escapeHtml(String(r)) + '</div>';
					detail.hidden = false;
					jPalate.querySelectorAll('.taste-dot.taste-dot--active').forEach(function (x) {
						x.classList.remove('taste-dot--active');
					});
					btn.classList.add('taste-dot--active');
					return;
				}
				if (e.target.closest('.taste-map-card') && !e.target.closest('button') && !e.target.closest('.taste-map-detail')) {
					detail.hidden = true;
					detail.innerHTML = '';
					jPalate.querySelectorAll('.taste-dot.taste-dot--active').forEach(function (x) {
						x.classList.remove('taste-dot--active');
					});
				}
			});
		}
	}

	function start() {
		loadStockViewPrefs();
		loadJournalViewPrefs();
		wireLandingAndPickers();

		if ('serviceWorker' in navigator && location.protocol !== 'file:') {
			navigator.serviceWorker.register('sw.js').catch(function () {});
		}
		var hasStock = window.BEER_DATA && Array.isArray(window.BEER_DATA) && window.BEER_DATA.length > 0;
		var hasRatings = window.RATINGS_DATA && Array.isArray(window.RATINGS_DATA) && window.RATINGS_DATA.length > 0;
		if (hasStock || hasRatings) {
			showMainUI();
			loadRecentlyDrankFromStorage();
			loadDrankArchiveFromStorage();
			if (hasStock) applyStockData(normaliseBeers(window.BEER_DATA));
			if (hasRatings) applyRatingsData(isPreNormalisedRatings(window.RATINGS_DATA) ? normalisePreNormalisedRatings(window.RATINGS_DATA) : normaliseRatingsFromUntappd(window.RATINGS_DATA));
			if (hasStock && hasRatings) mode = 'stock';
			else if (hasRatings) mode = 'ratings';
			setBeersFromMode();
			updateModeUI();
			if (!inited) { init(); inited = true; }
			return;
		}
		var savedStock = null;
		var savedRatings = null;
		try {
			if (typeof localStorage !== 'undefined') {
				savedStock = localStorage.getItem('mybeer_stock');
				savedRatings = localStorage.getItem('mybeer_ratings');
			}
		} catch (e) {}
		if (savedStock || savedRatings) {
			showMainUI();
			loadRecentlyDrankFromStorage();
			loadDrankArchiveFromStorage();
			if (savedStock) {
				try {
					var parsed = JSON.parse(savedStock);
					if (Array.isArray(parsed) && parsed.length > 0) stockBeers = normaliseBeers(parsed);
				} catch (e) {}
			}
			if (savedRatings) {
				try {
					var parsed = JSON.parse(savedRatings);
					if (Array.isArray(parsed) && parsed.length > 0) ratingBeers = normalisePreNormalisedRatings(parsed);
				} catch (e) {}
			}
			if (stockBeers.length && ratingBeers.length) mode = 'stock';
			else if (ratingBeers.length) mode = 'ratings';
			setBeersFromMode();
			updateStats();
			refreshChips();
			updateModeUI();
			if (!inited) { init(); inited = true; }
			return;
		}
		showLanding();
		wireLandingAndPickers();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', start);
	} else {
		start();
	}
})();
