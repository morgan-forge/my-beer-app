/**
 * My Beer - beer journal from your Untappd ratings (beer-journal-YYYY-MM-DD.json).
 * The Stock side (cupboard/fridge/drank/archive/shelf) was archived on 2026-10-17: git tag stock-final-2026-10-17.
 */

(function () {
	'use strict';

	var ratingBeers = []; // the journal: one entry per beer
	var activeFilters = { style: new Set(), brewery: new Set() };
	var filterOpen = false;
	var inited = false;

	function beerDisplayName(b) {
		if (!b || typeof b !== 'object') return 'Beer';
		var name = (b.beer_name != null ? String(b.beer_name) : '').trim();
		var brewery = (b.brewery_name != null ? String(b.brewery_name) : '').trim();
		if (brewery && name) return brewery + ' ' + name;
		return name || brewery || 'Beer';
	}

	var journalSort = 'date';
	var journalSortDir = 1;
	var journalSortBarWired = false;
	var journalTasteMapWired = false;
	var JOURNAL_LIST_CAP = 10;
	var journalShowAll = false;
	var journalPalateOpen = true;
	var journalRatingFilter = null; // a half-star bucket (e.g. 4.5) picked by tapping the rating distribution
	var journalTypeFilter = null; // a taste-map type key (e.g. 'ipa') picked with the taste-map buttons
	var JOURNAL_SORTS = [
		{ key: 'date', icon: '📅', label: 'Date' },
		{ key: 'rating', icon: '★', label: 'Rating' },
		{ key: 'abv', icon: '%', label: 'ABV' },
		{ key: 'style', icon: '🍺', label: 'Style' },
		{ key: 'alpha', icon: '🔤', label: 'A–Z' }
	];

	function get(id) { return document.getElementById(id); }

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

	/** Untappd's generic "Insiders" banner: some brewery pages serve it instead of a logo. Treat as no image. */
	function isUntappdPromoImage(url) {
		return String(url || '').indexOf('insiders.untappd.com') >= 0;
	}

	function getImageUrl(b) {
		return b.image_url && !isUntappdPromoImage(b.image_url) ? b.image_url : null;
	}

	function chipSourceList() {
		return ratingBeers;
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
		var lastDate = '';
		ratingBeers.forEach(function (b) {
			var d = b.created_at;
			if (d && (!lastDate || String(d) > lastDate)) lastDate = String(d);
		});
		statsEl.textContent = ratingBeers.length + ' rated' + (lastDate ? ' · Last: ' + formatRatingDate(lastDate) : '');
	}

	/** Half-star bucket a rating falls in (as the rating distribution groups them), or null when unrated. */
	function ratingBucket(b) {
		var r = normaliseUserRatingScoreForStorage(b.rating_score);
		return r == null ? null : Math.round(r * 2) / 2;
	}

	/** Beers matching the search and every active filter. skip = 'rating' or 'type' leaves that filter out, so its own chart still shows the full spread. */
	function filteredBeers(skip) {
		var query = (get('searchInput') && get('searchInput').value || '').trim().toLowerCase();
		var hasStyle = activeFilters.style.size > 0;
		var hasBrewery = activeFilters.brewery.size > 0;
		var byRating = journalRatingFilter != null && skip !== 'rating';
		var byType = journalTypeFilter != null && skip !== 'type';

		return ratingBeers.filter(function (b) {
			if (query) {
				var name = (b.beer_name || '').toLowerCase();
				var brewery = (b.brewery_name || '').toLowerCase();
				var style = (b.beer_type || '').toLowerCase();
				if (name.indexOf(query) === -1 && brewery.indexOf(query) === -1 && style.indexOf(query) === -1) return false;
			}
			if (hasStyle && !activeFilters.style.has(b.beer_type || '')) return false;
			if (hasBrewery && !activeFilters.brewery.has(b.brewery_name || '')) return false;
			if (byRating && ratingBucket(b) !== journalRatingFilter) return false;
			if (byType && tasteTypeOf(b) !== journalTypeFilter) return false;
			return true;
		});
	}

	function updateFilterCount(visible, total) {
		var n = activeFilters.style.size + activeFilters.brewery.size + (journalRatingFilter != null ? 1 : 0) + (journalTypeFilter != null ? 1 : 0);
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

	/** Active brewery/style/score/type filters as removable pills under the search bar. */
	function renderActiveFilterPills() {
		var el = get('activeFilterPills');
		if (!el) return;
		var html = '';
		if (journalTypeFilter != null) {
			html += '<button type="button" class="filter-pill" data-filter-key="type" data-value="">' +
				'<span class="filter-pill-name">' + escapeHtml(tasteTypeLabel(journalTypeFilter)) + '</span><span class="filter-pill-x" aria-hidden="true">✕</span></button>';
		}
		if (journalRatingFilter != null) {
			html += '<button type="button" class="filter-pill" data-filter-key="rating" data-value="">' +
				'<span class="filter-pill-name">' + journalRatingFilter + '★</span><span class="filter-pill-x" aria-hidden="true">✕</span></button>';
		}
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

	/** Rating distribution in half-star buckets. Each bar is a button: tap to filter the list to that score. */
	function buildHistogram(rated, selected) {
		var buckets = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
		var counts = buckets.map(function (b) {
			return rated.filter(function (d) { return ratingBucket(d) === b; }).length;
		});
		var maxCount = Math.max.apply(null, counts.concat([1]));
		var maxBarPx = 84;
		var minBarPx = 5;
		var html = '<div class="histogram' + (selected != null ? ' histogram--has-selection' : '') + '">';
		buckets.forEach(function (b, i) {
			var c = counts[i];
			var on = selected === b;
			var barH = c === 0 ? minBarPx : Math.round(minBarPx + (c / maxCount) * (maxBarPx - minBarPx));
			var cls = 'hist-bar';
			if (c === maxCount && c > 0) cls += ' hist-top';
			else if (c > 0 && c >= maxCount * 0.65) cls += ' hist-peak';
			html += '<button type="button" class="hist-col' + (on ? ' hist-col--active' : '') + '" data-rating="' + b + '" aria-pressed="' + on + '" aria-label="' + b + ' stars: ' + c + ' beers">' +
				'<span class="hist-bar-track">' +
				'<span class="' + cls + '" style="height:' + barH + 'px" title="' + b + '★: ' + c + '"></span>' +
				'</span>' +
				'<span class="hist-lbl">' + b + '</span>' +
				'</button>';
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
	}

	/** Journal bottom, after the list: rating distribution, taste map, then the counts. Redraws with the filters; foldable. */
	function renderPalate() {
		var el = get('journalPalate');
		if (!el) return;
		if (!ratingBeers.length) {
			el.innerHTML = '';
			return;
		}
		var html = '<button type="button" class="palate-toggle" id="palateToggle" aria-expanded="' + journalPalateOpen + '">' +
			'<span>Your palate ' + (journalPalateOpen ? '▴' : '▾') + '</span></button>';
		if (journalPalateOpen) {
			var view = filteredBeers();
			var viewStats = computeStats(view);
			var spread = computeStats(filteredBeers('rating'));
			var isFiltered = view.length < ratingBeers.length;
			html +=
				'<div class="journal-dash-stack">' +
				'<div class="dash-card wide"><div class="dash-lbl dash-lbl--split"><span>Rating distribution</span><span class="dash-hint">tap a bar to filter</span></div>' +
				(spread
					? '<div class="histogram-wrap">' + buildHistogram(spread.rated, journalRatingFilter) + '</div>'
					: '<p class="palate-empty">No rated beers match these filters.</p>') +
				'</div>' +
				buildTasteMapHtml(filteredBeers('type')) +
				(isFiltered ? buildJournalCompareHtml(viewStats) : buildJournalTotalsHtml()) +
				'</div>';
		}
		el.innerHTML = html;
	}

	/** Gold tier and journal size for the whole journal (shown while nothing is filtered). */
	function buildJournalTotalsHtml() {
		var all = computeStats(ratingBeers);
		if (!all) return '';
		return '<div class="dashboard-grid">' +
			'<div class="dash-card"><div class="dash-lbl">Gold tier</div><div class="dash-val">' + all.goldCount + '</div><div class="dash-sub">4.5★ or above</div></div>' +
			'<div class="dash-card"><div class="dash-lbl">Your journal</div><div class="dash-val">' + all.rated.length + '</div><div class="dash-sub">' + (all.breweryCount || 0) + ' breweries</div></div>' +
			'</div>';
	}

	/** "This view" against the whole journal, shown while a search or filter narrows the list. */
	function buildJournalCompareHtml(viewStats) {
		var all = computeStats(ratingBeers);
		if (!all) return '';
		var v = viewStats || { rated: [], goldCount: 0, breweryCount: 0 };
		function avgOf(arr) {
			if (!arr.length) return '–';
			var total = 0;
			arr.forEach(function (b) { total += normaliseUserRatingScoreForStorage(b.rating_score); });
			return (total / arr.length).toFixed(2) + '★';
		}
		function row(label, here, everywhere) {
			return '<span class="compare-k">' + label + '</span><span class="compare-v">' + here + '</span><span class="compare-v compare-v--all">' + everywhere + '</span>';
		}
		return '<div class="dash-card wide"><div class="dash-lbl">Your journal</div>' +
			'<div class="journal-compare">' +
			'<span></span><span class="compare-h">This view</span><span class="compare-h">All</span>' +
			row('Beers rated', v.rated.length, all.rated.length) +
			row('Breweries', v.breweryCount || 0, all.breweryCount || 0) +
			row('Gold tier (4.5★+)', v.goldCount, all.goldCount) +
			row('Average score', avgOf(v.rated), avgOf(all.rated)) +
			'</div></div>';
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

	/** Taste-map type buttons: the 14 dot colours folded into 9 types. swatch = the dot colour shown on the button. */
	var TASTE_TYPES = [
		{ key: 'ipa', label: 'IPA', swatch: 'ipa', cats: ['ipa'] },
		{ key: 'pale', label: 'Pale & bitter', swatch: 'pale', cats: ['pale'] },
		{ key: 'lager', label: 'Lager', swatch: 'lager', cats: ['lager'] },
		{ key: 'dark', label: 'Dark', swatch: 'porter_stout', cats: ['porter_stout', 'brown_amber', 'barleywine'] },
		{ key: 'sour', label: 'Sour & fruit', swatch: 'sours', cats: ['sours', 'fruited'] },
		{ key: 'wheat', label: 'Wheat', swatch: 'wheat', cats: ['wheat'] },
		{ key: 'belgian', label: 'Belgian', swatch: 'belgian', cats: ['belgian'] },
		{ key: 'na', label: 'Alcohol-free', swatch: 'na_low', cats: ['na_low'] },
		{ key: 'other', label: 'Other', swatch: 'other', cats: ['session', 'strong', 'other'] }
	];

	function tasteTypeOf(b) {
		var cat = tasteMapStyleCategory(b);
		for (var i = 0; i < TASTE_TYPES.length; i++) {
			if (TASTE_TYPES[i].cats.indexOf(cat) >= 0) return TASTE_TYPES[i].key;
		}
		return 'other';
	}

	function tasteTypeLabel(key) {
		for (var i = 0; i < TASTE_TYPES.length; i++) {
			if (TASTE_TYPES[i].key === key) return TASTE_TYPES[i].label;
		}
		return key;
	}

	/** Rated beers with a usable ABV, as plot points. */
	function tasteMapPoints(beers) {
		var pts = [];
		(beers || []).forEach(function (b) {
			var abv = parseFloat(b.beer_abv);
			var r = normaliseUserRatingScoreForStorage(b.rating_score);
			if (r == null || isNaN(abv) || abv < 0) return;
			pts.push({ b: b, abv: abv, r: r });
		});
		return pts;
	}

	/**
	 * Taste map: your score (up) by ABV (across). Type buttons narrow the map and the list to one type;
	 * the other types stay as faint dots. Axes come from the whole journal, so dots stay put when filtering.
	 */
	function buildTasteMapHtml(beers) {
		var allPts = tasteMapPoints(ratingBeers);
		if (allPts.length < 3) {
			return '<div class="dash-card wide taste-map-card taste-map-card--empty">' +
				'<div class="dash-lbl">Taste map</div>' +
				'<p class="taste-map-empty-msg">Need at least <strong>three</strong> rated check-ins with <strong>ABV</strong> (including 0% NA) to plot your map.</p>' +
				'</div>';
		}
		var basePts = tasteMapPoints(beers);
		var type = journalTypeFilter;
		var shownPts = type ? basePts.filter(function (p) { return tasteTypeOf(p.b) === type; }) : basePts;
		var ghostPts = type ? basePts.filter(function (p) { return tasteTypeOf(p.b) !== type; }) : [];

		var abvs = allPts.map(function (p) { return p.abv; });
		var rs = allPts.map(function (p) { return p.r; });
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

		function dotStyle(p) {
			var abvN = (p.abv - minAbv) / (maxAbv - minAbv);
			var ratN = (p.r - minR) / (maxR - minR);
			var h = tasteMapHash(String(p.b.item_id != null ? p.b.item_id : '') + '\t' + (p.b.beer_name || ''));
			var jx = ((h % 7) - 3) * 0.45;
			var jy = ((Math.floor(h / 7) % 7) - 3) * 0.45;
			var left = Math.max(3.5, Math.min(96.5, origin + abvN * plotW + jx));
			var top = Math.max(3.5, Math.min(96.5, origin + (1 - ratN) * plotH + jy));
			return 'left:' + left.toFixed(2) + '%;top:' + top.toFixed(2) + '%';
		}

		var cells = {};
		shownPts.forEach(function (p) {
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

		var minCountForSpot = shownPts.length >= 8 ? 2 : 1;
		function pickBestSpot(minC) {
			var bk = null;
			var bs = -1;
			Object.keys(cells).forEach(function (k) {
				var c = cells[k];
				if (c.count < minC) return;
				var score = c.count * (c.sum / c.count);
				if (score > bs) {
					bs = score;
					bk = k;
				}
			});
			return bk;
		}
		var bestKey = pickBestSpot(minCountForSpot);
		if (bestKey == null && minCountForSpot > 1) {
			bestKey = pickBestSpot(1);
		}

		var typeLabel = type ? escapeHtml(tasteTypeLabel(type)) : '';
		var spotHtml = '';
		var captionHtml = '<div class="taste-map-sweet-caption">No ' + (type ? typeLabel + ' ' : '') + 'beers with an ABV in this view</div>';
		if (bestKey != null) {
			var bc = cells[bestKey];
			var avgR = bc.sum / bc.count;
			var abvLo = minAbv + (bc.col / COLS) * (maxAbv - minAbv);
			var abvHi = minAbv + ((bc.col + 1) / COLS) * (maxAbv - minAbv);
			spotHtml = '<div class="taste-map-sweet" style="left:' + (origin + bc.col * cellW) + '%;top:' + (origin + bc.row * cellH) + '%;width:' + cellW + '%;height:' + cellH + '%" aria-hidden="true"></div>';
			captionHtml = '<div class="taste-map-sweet-caption">' + (type ? typeLabel + ' sweet spot' : 'Sweet spot') +
				' · ~' + abvLo.toFixed(1) + '–' + abvHi.toFixed(1) + '% ABV · ~' + avgR.toFixed(1) + '★ avg · ' + bc.count + ' beer' + (bc.count === 1 ? '' : 's') + '</div>';
		}

		var seenHighAbvRing = false;
		var dotsHtml = '';
		ghostPts.forEach(function (p) {
			dotsHtml += '<span class="taste-dot taste-dot--ghost" style="' + dotStyle(p) + '" aria-hidden="true"></span>';
		});
		shownPts.forEach(function (p) {
			var cat = tasteMapStyleCategory(p.b);
			var highRing = tasteMapUseHighAbvRing(cat, p.abv);
			if (highRing) seenHighAbvRing = true;
			dotsHtml +=
				'<button type="button" class="taste-dot taste-dot--' + cat + (highRing ? ' taste-dot--high-abv' : '') + '" ' +
				'style="' + dotStyle(p) + '" ' +
				'data-n="' + encodeURIComponent(p.b.beer_name || '') + '" ' +
				'data-w="' + encodeURIComponent(p.b.brewery_name || '') + '" ' +
				'data-abv="' + p.abv + '" data-r="' + p.r + '" ' +
				'aria-label="' + escapeHtml('Show: ' + beerDisplayName(p.b)) + '"></button>';
		});

		var counts = {};
		basePts.forEach(function (p) {
			var k = tasteTypeOf(p.b);
			counts[k] = (counts[k] || 0) + 1;
		});
		function typeChip(key, label, swatch, n) {
			var on = (key || null) === type;
			return '<button type="button" class="taste-type-chip' + (on ? ' taste-type-chip--active' : '') + '" data-type="' + key + '" aria-pressed="' + on + '">' +
				(swatch ? '<span class="taste-legend-swatch taste-legend-swatch--' + swatch + '"></span>' : '') +
				escapeHtml(label) + ' <span class="taste-type-count">' + n + '</span></button>';
		}
		var chipsHtml = '<div class="taste-type-chips" role="toolbar" aria-label="Beer types">' + typeChip('', 'All', '', basePts.length);
		TASTE_TYPES.forEach(function (t) {
			if (counts[t.key] || t.key === type) chipsHtml += typeChip(t.key, t.label, t.swatch, counts[t.key] || 0);
		});
		chipsHtml += '</div>';

		var ringNote = seenHighAbvRing
			? '<div class="taste-map-legend"><span class="taste-legend-item taste-legend-item--note"><span class="taste-legend-swatch taste-legend-swatch--ring-demo" aria-hidden="true"></span>8%+ ABV ring</span></div>'
			: '';

		return '<div class="dash-card wide taste-map-card">' +
			'<div class="dash-lbl dash-lbl--split"><span>Taste map</span><span class="dash-hint">types filter the list too</span></div>' +
			'<p class="taste-map-blurb">Your score (up) by ABV (across). Tap a dot to see the beer.</p>' +
			chipsHtml +
			captionHtml +
			'<div class="taste-map-body">' +
			'<div class="taste-map-y-axis" aria-hidden="true">' +
			'<span>' + maxR.toFixed(1) + '★</span><span>' + minR.toFixed(1) + '★</span>' +
			'</div>' +
			'<div class="taste-map-plot" role="img" aria-label="Scatter of journal beers: ABV versus your rating">' +
			'<div class="taste-map-grid-lines" aria-hidden="true"></div>' +
			spotHtml +
			dotsHtml +
			'</div>' +
			'</div>' +
			'<div class="taste-map-x-axis" aria-hidden="true">' +
			'<span>' + minAbv.toFixed(1) + '%</span><span>ABV</span><span>' + maxAbv.toFixed(1) + '%</span>' +
			'</div>' +
			ringNote +
			'<div id="tasteMapDetail" class="taste-map-detail" hidden></div>' +
			'</div>';
	}

	function render() {
		var list = get('beerList');
		if (!list) return;

		var query = (get('searchInput') && get('searchInput').value || '').trim();
		if (get('clearSearch')) get('clearSearch').style.display = query.length > 0 ? 'flex' : 'none';

		var items = sortJournalItems(filteredBeers());
		updateFilterCount(items.length, ratingBeers.length);
		renderJournalMore(items.length);
		syncBreweryRankRows();

		list.innerHTML = '';
		list.className = 'list list--journal';
		var frag = document.createDocumentFragment();
		var shownItems = (!journalShowAll && items.length > JOURNAL_LIST_CAP) ? items.slice(0, JOURNAL_LIST_CAP) : items;
		shownItems.forEach(function (b) { frag.appendChild(buildJournalCard(b)); });
		list.appendChild(frag);
		renderPalate();
	}

	/** "Show all / Show fewer" under the journal list, which shows JOURNAL_LIST_CAP beers until expanded. */
	function renderJournalMore(total) {
		var el = get('journalMore');
		if (!el) return;
		var show = total > JOURNAL_LIST_CAP;
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

	/** Show or hide the journal sections for whether a journal is loaded, then redraw. */
	function refreshJournalUI() {
		var hasJournal = ratingBeers.length > 0;
		var jDash = get('journalDashboard');
		var jPalate = get('journalPalate');
		var jArea = get('journalSortArea');
		if (jDash) jDash.classList.toggle('hidden', !hasJournal);
		if (jPalate) jPalate.classList.toggle('hidden', !hasJournal);
		if (jArea) jArea.classList.toggle('hidden', !hasJournal);
		if (hasJournal) {
			renderJournalSortBar();
			renderDashboard();
		} else {
			if (jDash) jDash.innerHTML = '';
			if (jPalate) jPalate.innerHTML = '';
		}

		var loadRatingsPrompt = get('loadRatingsPrompt');
		if (loadRatingsPrompt) loadRatingsPrompt.classList.toggle('hidden', hasJournal);
		var listEl = get('beerList');
		if (listEl) listEl.classList.toggle('hidden', !hasJournal);

		updateStats();
		render();
	}

	function clearAllFilters() {
		activeFilters.style.clear();
		activeFilters.brewery.clear();
		journalRatingFilter = null;
		journalTypeFilter = null;
		refreshChips();
		render();
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

	/** Saves the journal on this device. Stock data saved by older versions (mybeer_stock etc.) is left untouched. */
	function saveToStorage() {
		try {
			if (typeof localStorage === 'undefined') return;
			localStorage.setItem('mybeer_ratings', JSON.stringify(ratingBeers));
		} catch (e) {}
	}

	function applyRatingsData(normalised) {
		ratingBeers = normalised;
		refreshChips();
		refreshJournalUI();
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
		var btnRatings = get('btnLoadRatings');
		var ratingsInput = get('ratingsFileInput');
		if (!btnRatings || !ratingsInput) return;
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
				btnRatings.textContent = 'Load journal';
				btnRatings.disabled = false;
			}, function (msg) {
				alert(msg);
				ratingsInput.value = '';
				btnRatings.textContent = 'Load journal';
				btnRatings.disabled = false;
			});
		});
	}

	function init() {
		var searchInput = get('searchInput');
		if (searchInput) searchInput.addEventListener('input', render);

		if (get('clearSearch')) get('clearSearch').addEventListener('click', clearInput);
		if (get('filterToggle')) get('filterToggle').addEventListener('click', function () { setFilterOpen(!filterOpen); });
		if (get('filterDone')) get('filterDone').addEventListener('click', function () { setFilterOpen(false); });
		if (get('filterClearAll')) get('filterClearAll').addEventListener('click', clearAllFilters);

		var btnLoadRatingsInApp = get('btnLoadRatingsInApp');
		if (btnLoadRatingsInApp && get('ratingsFileInput')) btnLoadRatingsInApp.addEventListener('click', function () { get('ratingsFileInput').click(); });

		var pills = get('activeFilterPills');
		if (pills) {
			pills.addEventListener('click', function (e) {
				var pill = e.target.closest('.filter-pill');
				if (!pill) return;
				var key = pill.getAttribute('data-filter-key');
				var val = '';
				try { val = decodeURIComponent(pill.getAttribute('data-value') || ''); } catch (e1) {}
				if (key === 'rating') journalRatingFilter = null;
				else if (key === 'type') journalTypeFilter = null;
				else if (activeFilters[key]) activeFilters[key].delete(val);
				refreshChips();
				render();
			});
		}

		var btnUpload = get('btnUpload');
		if (btnUpload) btnUpload.addEventListener('click', function () { showLanding(); });

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
					renderPalate();
					return;
				}
				var typeChip = e.target.closest('.taste-type-chip');
				if (typeChip) {
					var picked = typeChip.getAttribute('data-type') || null;
					journalTypeFilter = (picked && journalTypeFilter !== picked) ? picked : null;
					journalShowAll = false;
					render();
					var mapCard = jPalate.querySelector('.taste-map-card');
					if (mapCard) mapCard.scrollIntoView({ block: 'center' });
					return;
				}
				var bar = e.target.closest('.hist-col[data-rating]');
				if (bar) {
					var score = parseFloat(bar.getAttribute('data-rating'));
					journalRatingFilter = journalRatingFilter === score ? null : score;
					journalShowAll = false;
					render();
					var chart = jPalate.querySelector('.histogram');
					if (chart) chart.scrollIntoView({ block: 'center' });
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
		loadJournalViewPrefs();
		wireLandingAndPickers();

		if ('serviceWorker' in navigator && location.protocol !== 'file:') {
			navigator.serviceWorker.register('sw.js').catch(function () {});
		}
		var bundled = window.RATINGS_DATA && Array.isArray(window.RATINGS_DATA) && window.RATINGS_DATA.length > 0 ? window.RATINGS_DATA : null;
		if (bundled) {
			showMainUI();
			applyRatingsData(isPreNormalisedRatings(bundled) ? normalisePreNormalisedRatings(bundled) : normaliseRatingsFromUntappd(bundled));
			return;
		}
		var saved = null;
		try {
			if (typeof localStorage !== 'undefined') saved = JSON.parse(localStorage.getItem('mybeer_ratings') || 'null');
		} catch (e) {}
		if (Array.isArray(saved) && saved.length > 0) {
			showMainUI();
			ratingBeers = normalisePreNormalisedRatings(saved);
			refreshChips();
			refreshJournalUI();
			if (!inited) { init(); inited = true; }
			return;
		}
		showLanding();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', start);
	} else {
		start();
	}
})();
