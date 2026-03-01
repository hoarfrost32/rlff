const DAYS = [1, 2, 3];

const isMaisonVenue = (venue = "") => venue.toUpperCase().includes("MAISON");

const getTravelMinutes = (fromVenue, toVenue) => {
  if (!fromVenue || !toVenue || fromVenue === toVenue) return 0;
  return isMaisonVenue(fromVenue) || isMaisonVenue(toVenue) ? 60 : 25;
};

const canAttendScreeningAfter = (previous, next) => {
  if (!previous) return true;
  if (next.dayId > previous.dayId) return true;
  if (next.dayId < previous.dayId) return false;
  return (
    next.startMinutes >=
    previous.endMinutes + getTravelMinutes(previous.venue, next.venue)
  );
};

const screeningSortKey = (screening) =>
  screening.dayId * 24 * 60 + screening.startMinutes;

const compareScreenings = (a, b) => {
  const startDelta = screeningSortKey(a) - screeningSortKey(b);
  if (startDelta !== 0) return startDelta;
  return a.endMinutes - b.endMinutes;
};

const makeDayVenueState = () =>
  Object.fromEntries(
    DAYS.map((dayId) => [
      dayId,
      { firstVenue: null, secondVenue: null, hasSwitched: false },
    ]),
  );

const encodeDayVenueState = (state) =>
  DAYS.map((dayId) => {
    const dayState = state[dayId];
    return `${dayState.firstVenue || "-"}>${dayState.secondVenue || "-"}>${dayState.hasSwitched ? 1 : 0}`;
  }).join("|");

const applyDayVenueRule = (state, screening) => {
  const currentDay = state[screening.dayId];
  if (!currentDay) return null;
  const venue = screening.venue;

  if (!currentDay.firstVenue) {
    return {
      ...state,
      [screening.dayId]: {
        firstVenue: venue,
        secondVenue: null,
        hasSwitched: false,
      },
    };
  }

  if (!currentDay.hasSwitched) {
    if (venue === currentDay.firstVenue) return state;
    return {
      ...state,
      [screening.dayId]: {
        firstVenue: currentDay.firstVenue,
        secondVenue: venue,
        hasSwitched: true,
      },
    };
  }

  if (venue === currentDay.secondVenue) return state;
  return null;
};

const toPlanScreening = (screening) => ({
  id: screening.id,
  dayId: screening.dayId,
  venue: screening.venue,
  screen: screening.screen,
  time: screening.time,
  title: screening.title,
  details: screening.details,
  startMinutes: screening.startMinutes,
  endMinutes: screening.endMinutes,
  isTBC: Boolean(screening.isTBC),
});

const normalizeFilms = (films) =>
  Array.isArray(films)
    ? films
        .map((film) => ({
          title: typeof film?.title === "string" ? film.title : "",
          screenings: Array.isArray(film?.screenings)
            ? film.screenings
                .map((screening) => ({
                  id: screening?.id,
                  dayId: screening?.dayId,
                  venue: screening?.venue || "",
                  screen: screening?.screen || "",
                  time: screening?.time || "",
                  title: screening?.title || "",
                  details: screening?.details || "",
                  startMinutes: screening?.startMinutes,
                  endMinutes: screening?.endMinutes,
                  isTBC: Boolean(screening?.isTBC),
                }))
                .filter(
                  (screening) =>
                    Number.isInteger(screening.id) &&
                    DAYS.includes(screening.dayId) &&
                    Number.isFinite(screening.startMinutes) &&
                    Number.isFinite(screening.endMinutes),
                )
            : [],
        }))
        .filter((film) => film.title && film.screenings.length > 0)
    : [];

const buildGreedyWatchlistPlan = (candidates) => {
  const unwatchedTitles = new Set(candidates.map((item) => item.title));
  const sorted = [...candidates].sort(compareScreenings);
  const selected = [];
  let current = null;
  let dayVenueState = makeDayVenueState();
  while (unwatchedTitles.size) {
    let best = null;
    let bestDayVenueState = null;
    for (const screening of sorted) {
      if (!unwatchedTitles.has(screening.title)) continue;
      if (!canAttendScreeningAfter(current, screening)) continue;
      const nextDayVenueState = applyDayVenueRule(dayVenueState, screening);
      if (!nextDayVenueState) continue;
      if (!best || compareScreenings(screening, best) < 0) {
        best = screening;
        bestDayVenueState = nextDayVenueState;
      }
    }
    if (!best) break;
    selected.push(toPlanScreening(best));
    unwatchedTitles.delete(best.title);
    current = best;
    dayVenueState = bestDayVenueState;
  }
  return selected;
};

const buildBestWatchlistPlan = (films, excludedScreeningIds = new Set()) => {
  if (!films.length) return [];
  const titleCount = films.length;
  if (titleCount > 20) {
    const flattened = films.flatMap((film, titleIndex) =>
      film.screenings.map((screening) => ({ ...screening, titleIndex })),
    );
    return buildGreedyWatchlistPlan(
      flattened.filter((screening) => !excludedScreeningIds.has(screening.id)),
    );
  }

  const screenings = films
    .flatMap((film, titleIndex) =>
      film.screenings.map((screening) => ({ ...screening, titleIndex })),
    )
    .filter((screening) => !excludedScreeningIds.has(screening.id))
    .sort(compareScreenings);

  if (!screenings.length) return [];

  const memo = new Map();
  const pickBetter = (candidate, incumbent) => {
    if (incumbent === -1) return true;
    const candidateItem = screenings[candidate];
    const incumbentItem = screenings[incumbent];
    return compareScreenings(candidateItem, incumbentItem) < 0;
  };

  const solve = (lastIndex, mask, dayVenueState) => {
    const memoKey = `${lastIndex}|${mask}|${encodeDayVenueState(dayVenueState)}`;
    if (memo.has(memoKey)) return memo.get(memoKey);

    let bestCount = 0;
    let bestNextIndex = -1;
    const previous = lastIndex === -1 ? null : screenings[lastIndex];

    for (let index = 0; index < screenings.length; index += 1) {
      const screening = screenings[index];
      const bit = 1 << screening.titleIndex;
      if (mask & bit) continue;
      if (!canAttendScreeningAfter(previous, screening)) continue;
      const nextDayVenueState = applyDayVenueRule(dayVenueState, screening);
      if (!nextDayVenueState) continue;

      const candidate = solve(index, mask | bit, nextDayVenueState);
      const candidateCount = 1 + candidate.bestCount;
      if (
        candidateCount > bestCount ||
        (candidateCount === bestCount && pickBetter(index, bestNextIndex))
      ) {
        bestCount = candidateCount;
        bestNextIndex = index;
      }
    }

    const resolved = { bestCount, bestNextIndex };
    memo.set(memoKey, resolved);
    return resolved;
  };

  const chosen = [];
  let lastIndex = -1;
  let mask = 0;
  let dayVenueState = makeDayVenueState();
  while (true) {
    const state = solve(lastIndex, mask, dayVenueState);
    if (state.bestNextIndex === -1) break;
    const next = screenings[state.bestNextIndex];
    chosen.push(toPlanScreening(next));
    mask |= 1 << next.titleIndex;
    lastIndex = state.bestNextIndex;
    dayVenueState = applyDayVenueRule(dayVenueState, next) || dayVenueState;
  }
  return chosen;
};

const buildWatchlistPlans = (films, desiredPlanCount = 3) => {
  if (!films.length) return [];
  const plans = [];
  const seenPlanKeys = new Set();
  const seenExclusionKeys = new Set();
  const queue = [new Set()];
  let iterations = 0;

  while (queue.length && plans.length < desiredPlanCount && iterations < 120) {
    iterations += 1;
    const exclusions = queue.shift();
    const exclusionKey = [...exclusions].sort((a, b) => a - b).join(",");
    if (seenExclusionKeys.has(exclusionKey)) continue;
    seenExclusionKeys.add(exclusionKey);

    const plan = buildBestWatchlistPlan(films, exclusions);
    if (!plan.length) continue;

    const planKey = plan
      .map((screening) => screening.id)
      .sort((a, b) => a - b)
      .join(",");
    if (seenPlanKeys.has(planKey)) continue;
    seenPlanKeys.add(planKey);
    plans.push(plan);

    for (const screening of plan) {
      const nextExclusions = new Set(exclusions);
      nextExclusions.add(screening.id);
      queue.push(nextExclusions);
      if (queue.length > 300) break;
    }
  }

  return plans;
};

self.addEventListener("message", (event) => {
  const { requestId, films, desiredPlanCount } = event.data || {};
  try {
    const normalizedFilms = normalizeFilms(films);
    const plans = buildWatchlistPlans(
      normalizedFilms,
      Number.isInteger(desiredPlanCount) ? desiredPlanCount : 3,
    );
    self.postMessage({ requestId, plans });
  } catch (error) {
    self.postMessage({
      requestId,
      error:
        error instanceof Error ? error.message : "Unknown watchlist planner error",
    });
  }
});
