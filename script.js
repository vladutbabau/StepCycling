'use strict';

// Numele afisate in romana pentru fiecare tip de antrenament
const typeNames = { running: 'Alergare', cycling: 'Mers cu bicicleta' };

class Workout {
  id = (Date.now() + '').slice(-10);
  date = new Date();
  constructor(coords, distance, duration) {
    this.coords = coords;
    this.distance = distance;
    this.duration = duration;
  }

  _setDescription() {
    // prettier-ignore
    const months = ['Ianuarie', 'Februarie', 'Martie', 'Aprilie', 'Mai', 'Iunie', 'Iulie', 'August', 'Septembrie', 'Octombrie', 'Noiembrie', 'Decembrie'];
    this.description = `${typeNames[this.type]} în data de ${this.date.getDate()} ${
      months[this.date.getMonth()]
    } ${this.date.getFullYear()}`;
  }
}

class Running extends Workout {
  type = 'running';
  constructor(coords, distance, duration, cadence) {
    super(coords, distance, duration);
    this.cadence = cadence;
    this.calcPace();
    this._setDescription();
  }

  calcPace() {
    this.pace = this.duration / this.distance;
    return this.pace;
  }
}

class Cycling extends Workout {
  type = 'cycling';
  constructor(coords, distance, duration, elevationGain) {
    super(coords, distance, duration);
    this.elevationGain = elevationGain;
    this.calcSpeed();
    this._setDescription();
  }

  calcSpeed() {
    this.speed = this.distance / (this.duration / 60);
    return this.speed;
  }
}

// const run1 = new Running([32, -12], 5.2, 24, 178);
// const cycling1 = new Cycling([32, -12], 27, 95, 523);
// console.log(run1, cycling1);
////////////////////////////////////////////////
// ARHITECTURA APLICATIEI
const form = document.querySelector('.form');
const containerWorkouts = document.querySelector('.workouts');
const inputType = document.querySelector('.form__input--type');
const inputDistance = document.querySelector('.form__input--distance');
const inputDuration = document.querySelector('.form__input--duration');
const inputCadence = document.querySelector('.form__input--cadence');
const inputElevation = document.querySelector('.form__input--elevation');
const resetBtn = document.querySelector('.form__btn--reset');
const submitBtn = document.querySelector('.form__btn--ok');
const clearRouteBtn = document.querySelector('.form__btn--clear-route');
const guide = document.querySelector('.guide');
const keepDialog = document.querySelector('.keep');
const resetDialog = document.querySelector('.confirm-reset');
const deleteDialog = document.querySelector('.confirm-delete');
const tutorialCard = document.querySelector('.tutorial');
const menuBtn = document.querySelector('.menu-btn');
const statsDialog = document.querySelector('.stats');
const summaryBox = document.querySelector('.summary');
const showAllBtn = document.querySelector('.show-all');

// true pe ecrane mici (telefon), unde harta e sus si lista dedesubt.
// Trebuie sa fie aceeasi latime ca in @media din style.css
const isMobile = () => window.matchMedia('(max-width: 768px)').matches;

// "Rigla" cu care masuram cat de lat e un text (pentru "minut" / "minute")
const measureCtx = document.createElement('canvas').getContext('2d');

// Unitatea corecta gramatical in romana, dupa numar:
//   1                        -> "minut"       (one)
//   0, 2-19, 101-119, 2,5... -> "minute"      (many)
//   20-99, 100, 120-199...   -> "de minute"   ("de" + many)
// "de" se pune doar la numere intregi ale caror ultime doua cifre
// sunt 00 sau de la 20 in sus. La numere negative ne uitam la valoare
// fara semn (ex: -50 de metri).
const unitText = (number, one, many) => {
  const n = Math.abs(number);
  if (n === 1) return one;
  const lastTwo = n % 100;
  const needsDe = Number.isInteger(n) && n !== 0 && (lastTwo === 0 || lastTwo >= 20);
  return needsDe ? `de ${many}` : many;
};

// Denivelarea: "-" (sau gol) inseamna ca nu a fost deal/munte
const hasElevation = workout =>
  workout.elevationGain !== null && workout.elevationGain !== undefined;

// Culorile traseului pe harta (aceleasi ca in style.css)
const routeColors = { running: '#00c46a', cycling: '#ffb545' };
// Culoarea din interiorul drumului conturat (aproape ca fundalul hartii)
const routeInnerColor = '#2d3439';

class App {
  #map;
  #mapZoomLevel = 14;
  #workouts = [];
  // Punctele pe care s-a dat click (primul = start, ultimul = final)
  #routePoints = [];
  // Linia completa a traseului (pe strazi, daca s-a putut calcula)
  #routePath = [];
  // Numarul ultimei cereri de traseu (ca sa ignoram raspunsurile vechi)
  #routeRequestId = 0;
  // true cat timp asteptam raspunsul cu traseul
  #routeLoading = false;
  // Desenul temporar al traseului, cat timp formularul e deschis
  #draftRoute;
  // ID-ul antrenamentului pe care il modificam (null = adaugam unul nou)
  #editingId = null;
  // Desenele de pe harta ale fiecarui antrenament (id -> grup de desene)
  #workoutLayers = new Map();
  // Tutorialul: pasul curent (0 = tutorialul nu ruleaza)
  #tutorialStep = 0;
  // Cele doua puncte de exemplu (start si final) si cercul care pulseaza
  #tutorialPoints = [];
  #tutorialTarget = null;
  // true daca tutorialul trebuie pornit imediat ce se incarca harta
  #tutorialPending = false;
  // true cat timp reparam antrenamentele salvate cu linii drepte
  #repairing = false;
  // Antrenamentul ales (traseul lui e deasupra, restul estompate). null = niciunul
  #selectedId = null;
  // Traseele care se suprapun sunt desenate decalate (ca liniile de metrou):
  // id -> cati pixeli e mutat traseul la stanga/dreapta (0 = nemutat)
  #routeOffsets = new Map();
  // Liniile fiecarui traseu salvat, ca sa le putem muta cand se da zoom:
  // id -> { lines, route, animating }
  #routeLines = new Map();
  constructor() {
    this._init();
    this._getLocalStorage();
    // Daca nu exista niciun antrenament, aratam fereastra de ghidare
    if (this.#workouts.length === 0) this._showGuide();
    form.addEventListener('submit', this._newWorkout.bind(this));
    inputType.addEventListener('change', this._updateTypeFields);
    // Recalculam pasii/min de fiecare data cand se scrie durata
    inputDuration.addEventListener('input', this._updateCadence.bind(this));
    // ...si mutam "minut" / "minute" imediat dupa numarul scris
    inputDuration.addEventListener('input', () => this._updateSuffixes());
    inputElevation.addEventListener('input', () => this._updateSuffixes());
    // Recalculam traseul cand se schimba tipul (pe jos vs. bicicleta)
    inputType.addEventListener('change', () => {
      if (this.#routePoints.length > 0) this._updateRoute();
    });
    containerWorkouts.addEventListener(
      'click',
      this._handleWorkoutClick.bind(this)
    );
    clearRouteBtn.addEventListener('click', this._clearRoute.bind(this));
    // "Resetează" deschide intai fereastra de confirmare
    resetBtn.addEventListener('click', this._confirmReset.bind(this));
    resetDialog
      .querySelector('.confirm-reset__yes')
      .addEventListener('click', () => this.reset());
    resetDialog
      .querySelector('.confirm-reset__no')
      .addEventListener('click', () => resetDialog.close());
    // Click pe fundalul intunecat = renunt
    resetDialog.addEventListener('click', e => {
      if (e.target === resetDialog) resetDialog.close();
    });
    // Fereastra de stergere a unui antrenament: "Nu" si fundalul o inchid
    deleteDialog
      .querySelector('.confirm-delete__no')
      .addEventListener('click', () => deleteDialog.close());
    deleteDialog.addEventListener('click', e => {
      if (e.target === deleteDialog) deleteDialog.close();
    });
    // Sumarul lunii (si cand nu exista inca niciun antrenament)
    this._updateSummary();
    // Cand revine internetul: refacem pe strazi traseul desenat acum
    // si reparam antrenamentele salvate cu linii drepte
    window.addEventListener('online', () => {
      if (this._draftIsStraight()) this._updateRoute(true);
      this._repairStraightRoutes();
    });
    // Butonul care arata iar toate traseele (iese din modul "focus")
    showAllBtn.addEventListener('click', () => this._selectWorkout(null));
    // Meniul ☰ cu statisticile
    menuBtn.addEventListener('click', this._openStats.bind(this));
    statsDialog
      .querySelector('.stats__close')
      .addEventListener('click', () => statsDialog.close());
    statsDialog.addEventListener('click', e => {
      if (e.target === statsDialog) statsDialog.close();
    });
    // Tasta Esc anuleaza antrenamentul inceput (si tutorialul).
    // Daca e deschisa o fereastra, Esc inchide doar fereastra.
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]'))
        return;
      if (!form.classList.contains('hidden')) this._hideForm();
      if (this.#tutorialStep) this._endTutorial();
      // Esc arata iar toate traseele
      this._selectWorkout(null);
    });
    // Tutorial: cand se scrie durata, trecem la pasul cu butonul
    inputDuration.addEventListener('input', () => {
      const hasDuration = +inputDuration.value > 0;
      if (this.#tutorialStep === 3 && hasDuration) this._tutorialGo(4);
      if (this.#tutorialStep === 4 && !hasDuration) this._tutorialGo(3);
    });
    // X-ul din coltul formularului: face acelasi lucru ca tasta Esc
    form.querySelector('.form__close').addEventListener('click', () => {
      this._hideForm();
      if (this.#tutorialStep) this._endTutorial();
    });
    tutorialCard
      .querySelector('.tutorial__skip')
      .addEventListener('click', () => {
        this._hideForm();
        this._endTutorial();
      });
  }

  _showGuide() {
    // "Am înțeles" inchide fereastra si porneste tutorialul.
    // Tasta Esc si click-ul pe fundalul intunecat fac la fel.
    guide
      .querySelector('.guide__btn')
      .addEventListener('click', () => guide.close());
    guide.addEventListener('click', e => {
      if (e.target === guide) guide.close();
    });
    // "Nu, mulțumesc" inchide fereastra fara tutorial
    guide
      .querySelector('.guide__skip')
      .addEventListener('click', () => guide.close('skip'));
    guide.addEventListener('close', () => {
      if (guide.returnValue !== 'skip') this._startTutorial();
    });
    guide.showModal();
  }

  ////////////////////////////////////////////////
  // TUTORIAL (exemplu pas cu pas, pentru cine nu are niciun antrenament)

  _startTutorial() {
    // Harta inca se incarca: pornim tutorialul imediat ce e gata
    if (!this.#map) {
      this.#tutorialPending = true;
      return;
    }
    this.#tutorialPending = false;

    // Alegem doua puncte de exemplu langa centrul hartii
    // (cam 800 de metri intre ele)
    const { lat, lng } = this.#map.getCenter();
    this.#tutorialPoints = [
      [lat - 0.002, lng - 0.004],
      [lat + 0.002, lng + 0.004],
    ];
    // Lasam loc sus pentru caseta tutorialului, ca sa nu acopere cercurile
    this.#map.fitBounds(this.#tutorialPoints, {
      paddingTopLeft: isMobile() ? [40, 170] : [80, 230],
      paddingBottomRight: isMobile() ? [40, 40] : [80, 80],
    });

    tutorialCard.classList.remove('tutorial--hidden');
    this._tutorialGo(1);
  }

  _tutorialGo(step) {
    this.#tutorialStep = step;
    this._clearTutorialHints();

    // Pe calculator formularul e in stanga, pe telefon e sub harta
    const arrow = isMobile() ? '⬇️' : '⬅️';
    const where = isMobile() ? 'Sub hartă' : 'În stânga';
    // Textul din caseta, pentru fiecare pas
    const texts = {
      1: 'Dă click pe cercul care pulsează pe hartă. Acesta este locul de unde ai <strong>început</strong> antrenamentul.',
      2: 'Bun! Acum dă click pe al doilea cerc: locul unde ai <strong>terminat</strong> 🏁. Traseul se desenează singur pe străzi.',
      3: `${arrow} ${where}, scrie la <strong>Durata</strong> cât a durat antrenamentul, în minute (de exemplu 30).`,
      4: `${arrow} Perfect! Acum apasă butonul <strong>Adaugă antrenament</strong>.`,
      5: `${arrow} Ultimul pas! Deasupra butonului Resetează vezi km din <strong>luna aceasta</strong>. Totalurile și km din <strong>fiecare lună</strong> sunt în meniul <strong>☰</strong> de lângă logo. Apasă pe el.`,
    };
    tutorialCard.querySelector('.tutorial__step').textContent =
      `Pasul ${step} din 5`;
    tutorialCard.querySelector('.tutorial__text').innerHTML = texts[step];

    // Pasii 1 si 2: un cerc care pulseaza pe harta, unde trebuie dat click
    if (step === 1 || step === 2) {
      const point = this.#tutorialPoints[step - 1];
      this.#tutorialTarget = L.marker(point, {
        zIndexOffset: 1000,
        icon: L.divIcon({
          className: 'tutorial-target',
          html: '<span class="tutorial-target__pulse"></span><span class="tutorial-target__dot"></span><span class="tutorial-target__hand">👆</span>',
          iconSize: [40, 40],
          iconAnchor: [20, 20],
        }),
      })
        .addTo(this.#map)
        .on('click', () => {
          // Facem exact ce face un click obisnuit pe harta in acel punct
          this._handleMapClick({ latlng: L.latLng(point), fromTutorial: true });
          this._tutorialGo(step + 1);
        });
    }

    // Pasul 3: evidentiem campul Durata
    if (step === 3) {
      inputDuration.classList.add('tutorial-highlight');
      inputDuration.focus();
    }

    // Pasul 4: evidentiem butonul de adaugare
    if (step === 4) submitBtn.classList.add('tutorial-highlight');

    // Pasul 5: evidentiem sumarul lunii si meniul ☰
    if (step === 5) {
      tutorialCard.classList.remove('tutorial--hidden');
      summaryBox.classList.add('tutorial-highlight');
      menuBtn.classList.add('tutorial-highlight');
    }
  }

  _clearTutorialHints() {
    this.#tutorialTarget?.remove();
    this.#tutorialTarget = null;
    inputDuration.classList.remove('tutorial-highlight');
    submitBtn.classList.remove('tutorial-highlight');
    summaryBox.classList.remove('tutorial-highlight');
    menuBtn.classList.remove('tutorial-highlight');
  }

  _endTutorial() {
    this.#tutorialStep = 0;
    this.#tutorialPending = false;
    this._clearTutorialHints();
    tutorialCard.classList.add('tutorial--hidden');
  }

  _nudgeTutorial() {
    // Click in alta parte a hartii: "scuturam" caseta ca sa fie observata
    tutorialCard.classList.remove('tutorial--shake');
    void tutorialCard.offsetWidth; // reporneste animatia
    tutorialCard.classList.add('tutorial--shake');
  }

  _askKeepTutorialWorkout(id) {
    // Intrebam daca pastram antrenamentul facut in tutorial
    const yesBtn = keepDialog.querySelector('.keep__yes');
    const noBtn = keepDialog.querySelector('.keep__no');
    const onNo = () => {
      this._removeWorkout(id);
      keepDialog.close();
    };
    const onYes = () => keepDialog.close();
    yesBtn.addEventListener('click', onYes);
    noBtn.addEventListener('click', onNo);
    // Dupa inchidere scoatem ascultatorii, ca sa nu se adune
    keepDialog.addEventListener(
      'close',
      () => {
        yesBtn.removeEventListener('click', onYes);
        noBtn.removeEventListener('click', onNo);
        // Mai aratam unde se vad statisticile (pasul 5)
        this._tutorialGo(5);
      },
      { once: true }
    );
    keepDialog.showModal();
  }

  async _init() {
    try {
      const position = await this._getPosition();
      console.log(position);
      this._loadMap(position);
    } catch (err) {
      this._renderError(err.message);
    }
  }
  _renderError(message) {
    // Clauza de protectie in caz ca exista deja un mesaj in container sa nu se mai afiseze altul.
    let existingError = document.querySelector('.error__message');
    if (existingError) return;

    // Adaugam mesajul de eroare in container
    containerWorkouts.insertAdjacentHTML(
      'beforeend',
      `<div class="error__message">Ceva nu a mers bine: ${message}</div> `
    );

    // Stergem mesajul de eroare dupa 1.5 secunde
    setTimeout(() => {
      const errEl = document.querySelector('.error__message');
      if (errEl) errEl.remove();
    }, 1500);
  }
  _getPosition() {
    // navigator.geolocation.getCurrentPosition(this._loadMap.bind(this), () => {
    //   alert(`Coordonatele nu au putut fi preluate`);
    // });
    const defaultCoords = {
      latitude: 44.4268, // Latitudine implicită (ex: București)
      longitude: 26.1025, // Longitudine implicită (ex: București)
    };
    if (navigator.geolocation) {
      return new Promise((resolve, reject) => {
        // navigator.geolocation.getCurrentPosition(
        //   position => resolve(position),
        //   err => reject(err)
        // );
        navigator.geolocation.getCurrentPosition(
          position => resolve(position),
          err => {
            this._renderError(
              'Permisiunea a fost refuzată sau este o eroare la geolocație'
            );
            resolve({ coords: defaultCoords });
          }
        );
      });
    } else {
      this._renderError(
        'Pozitia nu a fost gasita si coordonatele au fost setate implicit'
      );
      return Promise.resolve({ coords: defaultCoords });
    }
  }

  _loadMap(position) {
    const { latitude, longitude } = position.coords;
    const coords = [latitude, longitude];
    this.#map = L.map('map').setView(coords, this.#mapZoomLevel);
    // console.log(
    //   `Coordonatele au fost preluate cu succes - longitudine: ${longitude}, latitudine: ${latitude}`
    // );
    L.tileLayer(
      'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}.png',
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }
    ).addTo(this.#map);
    // Click-uri pe harta
    this.#map.on('click', this._handleMapClick.bind(this));
    // Stratul pe care desenam traseul temporar
    this.#draftRoute = L.layerGroup().addTo(this.#map);

    // Intai aflam ce trasee se suprapun, apoi le desenam
    this._computeOffsets();
    this.#workouts.forEach(workout => this._renderWorkoutMarker(workout));
    // Decalajul e in pixeli pe ecran, asa ca il refacem la fiecare zoom
    this.#map.on('zoomend', () => this._updateOffsetLines());

    // Fereastra de ghidare s-a inchis inainte sa fie gata harta
    if (this.#tutorialPending) this._startTutorial();

    // Antrenamentele salvate fara internet au ramas cu linii drepte:
    // incercam sa le refacem pe strazi
    this._repairStraightRoutes();
  }

  _handleMapClick(mapE) {
    // In tutorial se da click doar pe cercul care pulseaza
    if (this.#tutorialStep && !mapE.fromTutorial) return this._nudgeTutorial();
    const { lat, lng } = mapE.latlng;
    // Primul click: incepem un antrenament nou (acesta e punctul de start)
    if (form.classList.contains('hidden')) {
      this.#routePoints = [];
      this._showForm();
    }
    // Fiecare click adauga un punct pe traseu
    this.#routePoints.push([lat, lng]);
    this._updateRoute();
  }

  // silent = true: nu mai aratam mesajul de eroare (la reincercari)
  async _updateRoute(silent = false) {
    const points = this.#routePoints;

    // Intai desenam linii drepte, ca click-ul sa se vada imediat
    this.#routePath = points;
    this._drawDraftRoute();
    this._setDistance(this._straightDistance(points));
    if (points.length < 2) return;

    // Apoi cerem drumul pe strazi
    const requestId = ++this.#routeRequestId;
    this.#routeLoading = true;
    try {
      const route = await this._fetchRoute(points, inputType.value);
      // Intre timp s-a dat alt click sau s-a anulat: raspunsul e vechi
      if (requestId !== this.#routeRequestId) return;
      this.#routePath = route.path;
      this._setDistance(route.km);
      this._drawDraftRoute();
    } catch (err) {
      if (requestId !== this.#routeRequestId) return;
      if (!silent)
        this._renderError(
          'Nu am găsit drumul pe străzi. Încerc din nou în câteva secunde.'
        );
      // Reincercam peste 10 secunde (de ex. daca a picat internetul)
      setTimeout(() => {
        // Intre timp s-a dat alt click, s-a anulat sau s-a salvat: nu mai e nevoie
        if (requestId !== this.#routeRequestId || !this._draftIsStraight())
          return;
        this._updateRoute(true);
      }, 10000);
    } finally {
      if (requestId === this.#routeRequestId) this.#routeLoading = false;
    }
  }

  _draftIsStraight() {
    // Traseul din formular a ramas cu linii drepte (calculul pe strazi a esuat).
    // Cand esueaza, #routePath ramane chiar lista punctelor pe care s-a dat click.
    return (
      !form.classList.contains('hidden') &&
      this.#routePoints.length >= 2 &&
      this.#routePath === this.#routePoints
    );
  }

  _isStraightRoute(workout) {
    // Un antrenament salvat are linii drepte daca traseul lui
    // e format doar din punctele pe care s-a dat click
    const route = workout.route;
    if (!route || route.length < 2) return false;
    const points = workout.waypoints;
    // Antrenamentele mai vechi nu au "waypoints": doar start + final
    if (!points) return route.length === 2;
    return (
      route.length === points.length &&
      route.every((p, i) => p[0] === points[i][0] && p[1] === points[i][1])
    );
  }

  async _repairStraightRoutes() {
    // Reparam pe rand (nu toate odata, ca sa nu incarcam serverele)
    if (!this.#map || this.#repairing) return;
    this.#repairing = true;
    let repaired = 0;
    try {
      const straight = this.#workouts.filter(w => this._isStraightRoute(w));
      for (const workout of straight) {
        // Nu atingem antrenamentul care e deschis pentru modificare
        if (workout.id === this.#editingId) continue;
        const points =
          workout.waypoints ?? [workout.route[0], workout.route.at(-1)];

        let route;
        try {
          route = await this._fetchRoute(points, workout.type);
        } catch {
          // Tot nu merge (probabil fara internet): incercam cand revine
          break;
        }
        // Intre timp a fost sters sau deschis pentru modificare
        if (!this.#workouts.includes(workout) || workout.id === this.#editingId)
          continue;

        // Noul traseu, pe strazi, si distanta lui
        workout.waypoints = points;
        workout.route = route.path;
        workout.distance = +route.km.toFixed(2);
        // Recalculam valorile care depind de distanta
        if (workout.type === 'running') {
          workout.pace = workout.duration / workout.distance;
          workout.cadence = this._calcCadence(
            workout.distance,
            workout.duration
          );
        } else {
          workout.speed = workout.distance / (workout.duration / 60);
        }
        this._redrawWorkout(workout);
        repaired++;
      }
    } finally {
      this.#repairing = false;
    }
    if (repaired) {
      // Salvam (asta reface si sumarul lunii)
      this._setLocalStorage();
      console.log(
        `Am refăcut pe străzi ${repaired} ${repaired === 1 ? 'traseu' : 'trasee'}.`
      );
    }
  }

  _redrawWorkout(workout) {
    // Refacem desenul de pe harta si elementul din lista (fara animatie)
    this.#workoutLayers.get(workout.id)?.remove();
    this._renderWorkoutMarker(workout);
    const el = containerWorkouts.querySelector(
      `.workout[data-id="${workout.id}"]`
    );
    if (el) el.outerHTML = this._workoutHTML(workout);
  }

  async _fetchRoute(points, type) {
    // Cerem traseul de la doua servicii in acelasi timp,
    // pentru ca fiecare gaseste uneori un drum mai scurt decat celalalt
    const results = await Promise.allSettled([
      this._fetchRouteOSRM(points, type),
      this._fetchRouteValhalla(points, type),
    ]);
    // Pastram doar raspunsurile reusite
    const routes = results
      .filter(result => result.status === 'fulfilled')
      .map(result => result.value);
    if (routes.length === 0) throw new Error('Niciun serviciu nu a gasit drum');

    // Alegem traseul cel mai scurt
    return routes.reduce((shortest, route) =>
      route.km < shortest.km ? route : shortest
    );
  }

  async _fetchRouteValhalla(points, type) {
    // Valhalla: serviciu gratuit care poate cauta direct drumul cel mai scurt
    const costing = type === 'cycling' ? 'bicycle' : 'pedestrian';
    const request = {
      locations: points.map(([lat, lng]) => ({ lat, lon: lng })),
      costing,
      costing_options: { [costing]: { shortest: true } },
      units: 'kilometers',
      directions_type: 'none',
    };
    const url = `https://valhalla1.openstreetmap.de/route?json=${encodeURIComponent(
      JSON.stringify(request)
    )}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Valhalla a raspuns cu ${res.status}`);
    const data = await res.json();

    // Traseul vine pe bucati (cate una intre doua puncte), le lipim
    const path = [];
    data.trip.legs.forEach((leg, i) => {
      const legPoints = this._decodePolyline(leg.shape);
      // Fiecare bucata incepe cu ultimul punct al celei dinainte
      path.push(...(i === 0 ? legPoints : legPoints.slice(1)));
    });
    return { path, km: data.trip.summary.length };
  }

  _decodePolyline(encoded) {
    // Valhalla trimite traseul comprimat intr-un text ("polyline", precizie 6).
    // Aici il transformam inapoi in perechi [lat, lng].
    const points = [];
    let index = 0;
    let lat = 0;
    let lng = 0;
    while (index < encoded.length) {
      for (const coord of ['lat', 'lng']) {
        let result = 0;
        let shift = 0;
        let byte;
        do {
          byte = encoded.charCodeAt(index++) - 63;
          result |= (byte & 0x1f) << shift;
          shift += 5;
        } while (byte >= 0x20);
        const delta = result & 1 ? ~(result >> 1) : result >> 1;
        if (coord === 'lat') lat += delta;
        else lng += delta;
      }
      points.push([lat / 1e6, lng / 1e6]);
    }
    return points;
  }

  async _fetchRouteOSRM(points, type) {
    // OSRM: serviciu gratuit de rutare pe hartile OpenStreetMap
    const profile = type === 'cycling' ? 'bike' : 'foot';
    // Serviciul vrea coordonatele ca "longitudine,latitudine;..."
    const coords = points.map(([lat, lng]) => `${lng},${lat}`).join(';');
    const url = `https://routing.openstreetmap.de/routed-${profile}/route/v1/driving/${coords}?overview=full&geometries=geojson`;

    // Renuntam daca serviciul nu raspunde in 10 secunde
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Serviciul de rutare a raspuns cu ${res.status}`);
    const data = await res.json();
    if (data.code !== 'Ok') throw new Error('Nu exista drum intre puncte');

    const route = data.routes[0];
    return {
      // Intoarcem coordonatele in ordinea folosita de Leaflet: [lat, lng]
      path: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      km: route.distance / 1000,
    };
  }

  _straightDistance(points) {
    // Suma distantelor in linie dreapta dintre puncte, in km
    let meters = 0;
    for (let i = 1; i < points.length; i++)
      meters += this.#map.distance(points[i - 1], points[i]);
    return meters / 1000;
  }

  _setDistance(km) {
    // Completam singuri campul Distanta (rotunjit la 2 zecimale)
    inputDistance.value = km > 0 ? +km.toFixed(2) : '';
    this._updateCadence();
  }

  _calcCadence(km, minutes) {
    // Un pas = un metru, deci numarul de pasi = distanta in metri.
    // Pasi pe minut = pasi / minute (rotunjit la numar intreg)
    return Math.round((km * 1000) / minutes);
  }

  _updateCadence() {
    // Completam singuri campul pasi/min cand avem distanta si durata
    const km = +inputDistance.value;
    const minutes = +inputDuration.value;
    inputCadence.value =
      km > 0 && minutes > 0 ? this._calcCadence(km, minutes) : '';
  }

  _clearRoute() {
    // Stergem traseul din formular; urmatorul click pe harta va fi noul start
    this.#routePoints = [];
    this.#routePath = [];
    this.#routeRequestId++;
    this.#routeLoading = false;
    this.#draftRoute.clearLayers();
    inputDistance.value = '';
    // In tutorial, o luam de la capat cu punctul de start
    if (this.#tutorialStep) this._tutorialGo(1);
  }

  _drawDraftRoute() {
    const color = routeColors[inputType.value];
    this.#draftRoute.clearLayers();
    if (this.#routePoints.length === 0) return;
    // Linia punctata (si conturata) a traseului
    this._outlinedRoute(this.#routePath, color, this.#draftRoute, true);
    // Cerc la punctul de start
    L.circleMarker(this.#routePoints[0], {
      radius: 7,
      color,
      fillOpacity: 1,
      interactive: false,
    }).addTo(this.#draftRoute);
    // Steag de finish la ultimul punct (daca avem deja mai mult de un punct)
    if (this.#routePath.length >= 2)
      this._finishFlag(this.#routePath[this.#routePath.length - 1], false).addTo(
        this.#draftRoute
      );
  }

  _outlinedRoute(path, color, group, dashed = false) {
    // Drumul "conturat": o linie colorata lata dedesubt si una inchisa,
    // mai subtire, deasupra. Din cea colorata se vad doar marginile.
    // Cu dashed = true (traseul inca nesalvat) liniile sunt punctate:
    // fiecare liniuta are si ea contur, pentru ca ambele linii au
    // aceleasi liniute, doar ca cea de dedesubt e mai lata.
    const extra = dashed
      ? { dashArray: '10 16', interactive: false }
      : {};
    const outer = L.polyline(path, { color, weight: 9, opacity: 1, ...extra });
    const inner = L.polyline(path, {
      color: routeInnerColor,
      weight: 5,
      opacity: 1,
      ...extra,
    });
    outer.addTo(group);
    inner.addTo(group);
    return [outer, inner];
  }

  _animateRoute(lines, path, onDone) {
    // Distanta de la start pana la fiecare punct al traseului, in metri
    const distances = [0];
    for (let i = 1; i < path.length; i++)
      distances.push(distances[i - 1] + this.#map.distance(path[i - 1], path[i]));
    const total = distances[distances.length - 1];

    // Cat dureaza animatia: 1.5 secunde + putin in plus la trasee lungi
    // (maxim 4 secunde)
    const duration = Math.min(1500 + total / 5, 4000);
    const startTime = performance.now();

    const step = now => {
      // progress merge de la 0 (start) la 1 (final)
      const progress = Math.min((now - startTime) / duration, 1);
      // Cati metri din traseu trebuie desenati acum
      const target = progress * total;

      // Cautam bucata de traseu (intre punctul i-1 si i) unde am ajuns
      let i = 1;
      while (i < path.length - 1 && distances[i] < target) i++;
      const pieceLength = distances[i] - distances[i - 1];
      const t = pieceLength > 0 ? (target - distances[i - 1]) / pieceLength : 1;

      // Punctul exact de pe acea bucata, intre cele doua capete
      const [lat1, lng1] = path[i - 1];
      const [lat2, lng2] = path[i];
      const tip = [lat1 + (lat2 - lat1) * t, lng1 + (lng2 - lng1) * t];
      lines.forEach(line => line.setLatLngs([...path.slice(0, i), tip]));

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        lines.forEach(line => line.setLatLngs(path));
        onDone();
      }
    };
    requestAnimationFrame(step);
  }

  _finishFlag(coords, interactive = true, pop = false) {
    // Marker cu emoji-ul 🏁 in locul pinului obisnuit.
    // Cu pop = true, steagul apare cu o animatie (vezi .finish-flag__icon--pop)
    return L.marker(coords, {
      interactive,
      icon: L.divIcon({
        className: 'finish-flag',
        html: `<span class="finish-flag__icon${
          pop ? ' finish-flag__icon--pop' : ''
        }">🏁</span>`,
        iconSize: [28, 28],
        // Punctul din icon care sta exact pe harta: baza bastonului (stanga-jos)
        iconAnchor: [5, 26],
      }),
    });
  }

  _showForm() {
    // Cand incepem un antrenament, aratam iar toate traseele
    this._selectWorkout(null);
    // Textul butonului depinde daca adaugam sau modificam
    submitBtn.textContent = this.#editingId
      ? 'Salvează modificările'
      : 'Adaugă antrenament';
    form.classList.remove('hidden');
    // Distanta se calculeaza singura, asa ca incepem cu durata
    inputDuration.focus();
  }

  _hideForm() {
    // Stergem traseul temporar si ignoram cererile de traseu inca in curs
    this.#routePoints = [];
    this.#routePath = [];
    this.#routeRequestId++;
    this.#routeLoading = false;
    this.#draftRoute?.clearLayers();
    this.#editingId = null;
    form.classList.add('hidden');
    form.style.display = 'none';
    setTimeout(() => (form.style.display = 'grid'), 1000);
    // Resetam inputurile
    inputCadence.value =
      inputDistance.value =
      inputDuration.value =
      inputElevation.value =
        '';
    this._updateSuffixes();
  }

  _updateSuffixes() {
    // Unitatea lipita de numar: "1 minut", "5 minute", "30 de minute"
    // si "1 metru", "15 metri", "200 de metri"
    this._updateSuffix(inputDuration, 'minut', 'minute');
    this._updateSuffix(inputElevation, 'metru', 'metri');
  }

  _updateSuffix(input, one, many) {
    const suffix = input.parentElement.querySelector('.form__suffix');
    const value = input.value.trim();
    const number = +value.replace(',', '.');
    // Camp gol, "-" (fara deal) sau ceva ce nu e numar: fara unitate
    if (!value || !Number.isFinite(number)) {
      suffix.textContent = '';
      return;
    }
    suffix.textContent = unitText(number, one, many);

    // Masuram cat de lat e textul scris (cu acelasi font ca in camp)
    const style = getComputedStyle(input);
    measureCtx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const textWidth = measureCtx.measureText(value).width;
    // Unitatea incepe dupa margine + spatiul din stanga + text + un mic spatiu
    const left =
      parseFloat(style.borderLeftWidth) +
      parseFloat(style.paddingLeft) +
      textWidth +
      5;
    suffix.style.left = `${left}px`;
  }

  _updateTypeFields() {
    // Alergare -> aratam Cadenta; bicicleta -> aratam Denivelarea
    const isRunning = inputType.value === 'running';
    inputCadence
      .closest('.form__row')
      .classList.toggle('form__row--hidden', !isRunning);
    inputElevation
      .closest('.form__row')
      .classList.toggle('form__row--hidden', isRunning);
  }

  _newWorkout(e) {
    const isFinite = (...inputs) => inputs.every(inp => Number.isFinite(inp));
    const isPositive = (...inputs) => inputs.every(inp => inp > 0);
    e.preventDefault();

    // Preluam datele utilizatorului din formular
    const type = inputType.value;
    const distance = +inputDistance.value;
    const duration = +inputDuration.value;
    // Fara niciun click pe harta nu stim unde a fost antrenamentul
    if (this.#routePoints.length === 0)
      return this._renderError('Dă click pe hartă în punctul de start');
    // Distanta vine din traseu, deci avem nevoie de start si final.
    // (Exceptie: antrenamentele vechi, fara traseu, se pot modifica
    // pastrand distanta pe care o aveau.)
    if (this.#routePoints.length < 2 && !(this.#editingId && distance > 0))
      return this._renderError(
        'Dă click pe hartă și în punctul unde ai terminat'
      );
    // Asteptam sa se termine calculul traseului
    if (this.#routeLoading)
      return this._renderError('Se calculează traseul, încearcă din nou');
    // Markerul antrenamentului sta la punctul de start
    const [lat, lng] = this.#routePoints[0];
    let workout;
    // Daca este workout de alergare, cream obiectul running

    // Validam aceste date
    if (type === 'running') {
      // Pasii/min se calculeaza din distanta si durata (un pas = un metru)
      const cadence = this._calcCadence(distance, duration);
      if (
        !isFinite(distance, duration, cadence) ||
        !isPositive(distance, duration, cadence)
      )
        return this._renderError(`Inputurile trebuie sa fie numere pozitive!`);

      workout = new Running([lat, lng], distance, duration, cadence);
    }
    // Daca este workout de ciclism, cream obiectul cycling
    if (type === 'cycling') {
      // Denivelarea poate fi "-" (sau goala) cand nu a fost deal/munte,
      // sau un numar (si negativ, daca a fost mai mult la vale)
      const rawElevation = inputElevation.value.trim().replace(',', '.');
      const elevation =
        rawElevation === '' || rawElevation === '-' ? null : +rawElevation;
      if (elevation !== null && !Number.isFinite(elevation))
        return this._renderError('La denivelare scrie un număr sau „-”');
      if (!isFinite(distance, duration) || !isPositive(distance, duration))
        return this._renderError('Inputurile trebuie sa fie numere pozitive!');

      workout = new Cycling([lat, lng], distance, duration, elevation);
    }
    // Daca nu s-a creat niciun antrenament (tip necunoscut), ne oprim aici
    if (!workout) return;
    // Salvam traseul (de la start pana la final) si punctele pe care
    // s-a dat click (ca traseul sa poata fi modificat mai tarziu)
    workout.route = this.#routePath;
    workout.waypoints = this.#routePoints;

    if (this.#editingId) {
      this._replaceWorkout(this.#editingId, workout);
    } else {
      // Adaugam obiectul in workout array
      this.#workouts.push(workout);
      // Afisam workout-ul pe harta cu un marker (si traseul animat)
      this._renderWorkoutMarker(workout, true);
      // Afisam antrenamentele(workouts) intr-o lista
      this._renderWorkout(workout);
    }
    // Resetam campurile imputurilor si ascundem formularul
    this._hideForm();
    // Salvam in localStorage toate antrenamentele
    this._setLocalStorage();

    // Antrenamentul a fost facut in tutorial: dupa animatia traseului
    // intrebam daca il pastram
    if (this.#tutorialStep) {
      this._endTutorial();
      setTimeout(() => this._askKeepTutorialWorkout(workout.id), 2500);
    }
  }

  _replaceWorkout(id, workout) {
    const index = this.#workouts.findIndex(w => w.id === id);
    if (index === -1) return;
    const oldWorkout = this.#workouts[index];

    // Pastram ID-ul si data antrenamentului original
    workout.id = oldWorkout.id;
    workout.date = new Date(oldWorkout.date);
    workout._setDescription();
    this.#workouts[index] = workout;

    // Inlocuim desenele de pe harta
    this.#workoutLayers.get(id)?.remove();
    this._renderWorkoutMarker(workout, true);

    // Inlocuim elementul din lista, pe acelasi loc
    const oldEl = containerWorkouts.querySelector(`.workout[data-id="${id}"]`);
    if (oldEl) oldEl.outerHTML = this._workoutHTML(workout);
  }

  _startEdit(id) {
    if (!this.#map) return this._renderError('Harta încă se încarcă');
    const workout = this.#workouts.find(w => w.id === id);
    if (!workout) return;

    // Pornim de la un formular gol, apoi il completam cu datele antrenamentului
    this._hideForm();
    this.#editingId = id;
    inputType.value = workout.type;
    this._updateTypeFields();
    inputDistance.value = workout.distance;
    inputDuration.value = workout.duration;
    if (workout.type === 'running') this._updateCadence();
    else inputElevation.value = hasElevation(workout) ? workout.elevationGain : '-';
    this._updateSuffixes();

    // Incarcam traseul ca ciorna. Antrenamentele mai vechi nu au
    // "waypoints", asa ca folosim startul si finalul traseului.
    const route = workout.route?.length >= 2 ? workout.route : null;
    // (Facem copii, ca sa nu stricam antrenamentul salvat daca anulam)
    this.#routePoints = workout.waypoints
      ? [...workout.waypoints]
      : route
      ? [route[0], route[route.length - 1]]
      : [workout.coords];
    this.#routePath = route ? [...route] : [...this.#routePoints];
    this._drawDraftRoute();

    // Afisam formularul (anulam ascunderea pornita de _hideForm)
    form.style.display = 'grid';
    this._showForm();
    this._moveToWorkout(workout);
  }

  _deleteWorkout(id) {
    const workout = this.#workouts.find(w => w.id === id);
    if (!workout) return;
    // Intrebam intr-o fereastra a aplicatiei (nu cu "confirm" din browser)
    deleteDialog.querySelector('.confirm-delete__name').textContent =
      workout.description;
    const yesBtn = deleteDialog.querySelector('.confirm-delete__yes');
    const onYes = () => {
      this._removeWorkout(id);
      deleteDialog.close();
    };
    yesBtn.addEventListener('click', onYes);
    // Dupa inchidere (orice buton, Esc sau click pe fundal) scoatem
    // ascultatorul, ca sa nu stearga alt antrenament data viitoare
    deleteDialog.addEventListener(
      'close',
      () => yesBtn.removeEventListener('click', onYes),
      { once: true }
    );
    deleteDialog.showModal();
  }

  _removeWorkout(id) {
    if (this.#selectedId === id) this._selectWorkout(null);
    // Daca tocmai il modificam, inchidem formularul
    if (this.#editingId === id) this._hideForm();

    this.#workouts = this.#workouts.filter(w => w.id !== id);
    this.#workoutLayers.get(id)?.remove();
    this.#workoutLayers.delete(id);
    this.#routeLines.delete(id);
    containerWorkouts.querySelector(`.workout[data-id="${id}"]`)?.remove();
    this._setLocalStorage();
  }

  _renderWorkout(workout) {
    form.insertAdjacentHTML('afterend', this._workoutHTML(workout));
  }

  _workoutHTML(workout) {
    let html = `
    <li class="workout workout--${workout.type}" data-id="${workout.id}">
      <div class="workout__header">
        <h2 class="workout__title">${workout.description}</h2>
        <div class="workout__actions">
          <button class="workout__btn workout__btn--edit" title="Modifică">
            <!-- Creion desenat (SVG), ca sa poata fi colorat din CSS -->
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17 3l4 4L8 20H4v-4L17 3zM14 6l4 4" />
            </svg>
          </button>
          <button class="workout__btn workout__btn--delete" title="Șterge">
            <!-- Cos de gunoi desenat (SVG), ca sa poata fi colorat din CSS -->
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
            </svg>
          </button>
        </div>
      </div>
      <div class="workout__details">
       <span class="workout__icon">${
         workout.type === 'running' ? '🏃‍♂️' : '🚴‍♀️'
       }</span>
       <span class="workout__value">${workout.distance}</span>
       <span class="workout__unit">km</span>
      </div>
      <div class="workout__details">
       <span class="workout__icon">⏱</span>
       <span class="workout__value">${workout.duration}</span>
       <span class="workout__unit">min</span>
      </div>`;

    if (workout.type === 'running') {
      html += `<div class="workout__details">
        <span class="workout__icon">⚡️</span>
        <span class="workout__value">${workout.pace.toFixed(1)}</span>
        <span class="workout__unit">min/km</span>
      </div>
      <div class="workout__details">
        <span class="workout__icon">🦶🏼</span>
        <span class="workout__value">${workout.cadence}</span>
        <span class="workout__unit">pași/min</span>
      </div>
    </li>`;
    }

    if (workout.type === 'cycling') {
      html += `<div class="workout__details">
      <span class="workout__icon">⚡️</span>
      <span class="workout__value">${workout.speed.toFixed(1)}</span>
      <span class="workout__unit">km/h</span>
    </div>
    <div class="workout__details">
      <span class="workout__icon">⛰</span>
      <span class="workout__value">${
        hasElevation(workout) ? workout.elevationGain : '-'
      }</span>
      <span class="workout__unit">${hasElevation(workout) ? 'm' : ''}</span>
    </div>
  </li>`;
    }

    return html;
  }

  _renderWorkoutMarker(workout, animate = false) {
    // Punem toate desenele antrenamentului intr-un grup,
    // ca sa le putem sterge impreuna mai tarziu
    // (featureGroup, ca sa putem asculta click-urile pe tot grupul)
    const group = L.featureGroup().addTo(this.#map);
    this.#workoutLayers.set(workout.id, group);

    // Click pe traseu (sau pe pin): alegem acest antrenament.
    // Daca formularul e deschis, click-ul merge mai departe la harta
    // (ca sa poti pune puncte si pe un drum unde exista deja un traseu).
    group.on('click', e => {
      if (!form.classList.contains('hidden') || this.#tutorialStep) return;
      L.DomEvent.stopPropagation(e);
      // Click pe traseul deja ales: aratam iar toate traseele
      this._selectWorkout(this.#selectedId === workout.id ? null : workout.id);
    });

    // Desenam traseul ingrosat, daca are cel putin 2 puncte
    if (workout.route && workout.route.length >= 2) {
      const color = routeColors[workout.type];
      const end = workout.route[workout.route.length - 1];

      if (animate) {
        // Antrenament nou sau modificat: aflam din nou ce trasee se suprapun
        this._computeOffsets();
        // Linia porneste de la start si "creste" pana la final,
        // iar la final apare steagul
        const path = this._displayPath(workout);
        const lines = this._outlinedRoute([path[0]], color, group);
        const entry = { lines, route: workout.route, animating: true };
        this.#routeLines.set(workout.id, entry);
        this._animateRoute(lines, path, () => {
          entry.animating = false;
          // Intre timp s-a putut da zoom: punem linia la locul corect
          const finalPath = this._displayPath(workout);
          lines.forEach(line => line.setLatLngs(finalPath));
          this._finishFlag(end, true, true).addTo(group);
        });
      } else {
        const lines = this._outlinedRoute(
          this._displayPath(workout),
          color,
          group
        );
        this.#routeLines.set(workout.id, {
          lines,
          route: workout.route,
          animating: false,
        });
        // Steag de finish la punctul unde s-a terminat antrenamentul
        this._finishFlag(end).addTo(group);
      }
    }

    const popup = L.popup({
      maxWidth: 250,
      minWidth: 100,
      autoClose: false,
      closeOnClick: false,
      className: `${workout.type}-popup`,
    });
    popup.setContent(this._popupContent(workout, popup));

    L.marker(workout.coords).addTo(group).bindPopup(popup).openPopup();

    // Daca e ales alt antrenament, si acesta trebuie estompat
    this._applySelection();
  }

  ////////////////////////////////////////////////
  // TRASEE DECALATE (pentru traseele care se suprapun)

  _routeSamples(route) {
    // Luam cate un punct la fiecare ~10 m de-a lungul traseului
    // si notam prin ce "patratele" de ~20 m ale hartii trece
    const CELL = 0.0002; // ~20 m (in grade)
    const points = [];
    const cells = new Set();
    for (let i = 1; i < route.length; i++) {
      const [lat1, lng1] = route[i - 1];
      const [lat2, lng2] = route[i];
      const meters = this.#map.distance(route[i - 1], route[i]);
      const steps = Math.max(1, Math.ceil(meters / 10));
      for (let s = i === 1 ? 0 : 1; s <= steps; s++) {
        const t = s / steps;
        const lat = lat1 + (lat2 - lat1) * t;
        const lng = lng1 + (lng2 - lng1) * t;
        const key = [Math.round(lat / CELL), Math.round(lng / CELL)];
        points.push({ lat, lng, key });
        cells.add(key.join(','));
      }
    }
    return { points, cells };
  }

  _sharedPart(a, b) {
    // Punctele traseului "a" care sunt pe acelasi drum cu traseul "b".
    // Ne uitam si in patratelele vecine, pentru ca serviciile de rutare
    // pot pune punctele aceluiasi drum putin diferit.
    const shared = [];
    a.points.forEach((point, index) => {
      const [y, x] = point.key;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (b.cells.has(`${y + dy},${x + dx}`)) {
            shared.push(index);
            return;
          }
    });
    return shared;
  }

  _nearestIndex(samples, point) {
    // Al catelea punct din "samples" e cel mai aproape de "point"
    let best = 0;
    let bestDist = Infinity;
    samples.points.forEach((p, i) => {
      const dist = (p.lat - point.lat) ** 2 + (p.lng - point.lng) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    return best;
  }

  _computeOffsets() {
    this.#routeOffsets.clear();
    const SPACING = 9; // pixeli intre doua trasee alaturate (cat o linie)
    const list = this.#workouts.filter(w => w.route?.length >= 2);
    const samples = list.map(w => this._routeSamples(w.route));

    // Cine cu cine se suprapune (cel putin ~80 m de drum comun) si daca,
    // pe drumul comun, merg in acelasi sens sau in sensuri opuse
    const neighbors = list.map(() => []);
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const shared = this._sharedPart(samples[i], samples[j]);
        if (shared.length < 8) continue;
        // Unde incepe si unde se termina drumul comun, pe traseul i...
        const first = samples[i].points[shared[0]];
        const last = samples[i].points[shared[shared.length - 1]];
        // ...si in ce ordine sunt aceleasi locuri pe traseul j
        const sameWay =
          this._nearestIndex(samples[j], last) >=
          this._nearestIndex(samples[j], first);
        neighbors[i].push({ other: j, sameWay });
        neighbors[j].push({ other: i, sameWay });
      }

    // Fiecare traseu primeste o "banda" (0, 1, 2...), diferita de a
    // traseelor cu care se suprapune
    const slot = list.map(() => -1);
    list.forEach((_, i) => {
      const used = new Set(neighbors[i].map(n => slot[n.other]));
      let lane = 0;
      while (used.has(lane)) lane++;
      slot[i] = lane;
    });

    // Grupam traseele legate intre ele. Decalajul se masoara spre stanga
    // sensului de mers, asa ca un traseu care merge in sens opus
    // primeste semnul invers (altfel ar ajunge pe aceeasi parte).
    const sign = list.map(() => 0);
    list.forEach((_, start) => {
      if (sign[start]) return;
      const group = [];
      const stack = [start];
      sign[start] = 1;
      while (stack.length) {
        const i = stack.pop();
        group.push(i);
        neighbors[i].forEach(({ other, sameWay }) => {
          if (sign[other]) return;
          sign[other] = sameWay ? sign[i] : -sign[i];
          stack.push(other);
        });
      }
      // Benzile se aseaza centrat pe drum:
      // 2 trasee -> -4.5 px si +4.5 px; 3 trasee -> -9, 0, +9 etc.
      const lanes = Math.max(...group.map(i => slot[i])) + 1;
      group.forEach(i => {
        const offset = (slot[i] - (lanes - 1) / 2) * SPACING * sign[i];
        if (offset) this.#routeOffsets.set(list[i].id, offset);
      });
    });
  }

  _displayPath(workout) {
    // Traseul asa cum il desenam: mutat lateral daca se suprapune cu altul
    const offset = this.#routeOffsets.get(workout.id) ?? 0;
    return this._offsetPath(workout.route, offset);
  }

  _offsetPath(path, offset) {
    if (!offset || !this.#map || path.length < 2) return path;
    // Lucram in pixeli (la zoom-ul curent), apoi transformam inapoi
    const zoom = this.#map.getZoom();
    const pts = path.map(p => this.#map.project(p, zoom));

    // Cati pixeli mutam (semnul arata partea: stanga/dreapta sensului de mers)
    const d = offset;

    // Perpendiculara (de lungime 1) pe bucata dintre doua puncte
    const normal = (a, b) => {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      return len ? { x: -(b.y - a.y) / len, y: (b.x - a.x) / len } : null;
    };

    return pts.map((p, i) => {
      const n1 = i > 0 ? normal(pts[i - 1], p) : null;
      const n2 = i < pts.length - 1 ? normal(p, pts[i + 1]) : null;
      let nx, ny, scale = 1;
      if (n1 && n2) {
        // La colturi mergem pe "bisectoare", ca linia sa ramana paralela
        nx = n1.x + n2.x;
        ny = n1.y + n2.y;
        const len = Math.hypot(nx, ny);
        if (len < 1e-6) {
          nx = n2.x;
          ny = n2.y;
        } else {
          nx /= len;
          ny /= len;
          // La colturi ascutite limitam, ca sa nu iasa "tepi"
          scale = Math.min(1 / Math.max(nx * n1.x + ny * n1.y, 1e-6), 3);
        }
      } else {
        const n = n1 ?? n2;
        if (!n) return path[i];
        nx = n.x;
        ny = n.y;
      }
      // Inapoi in [lat, lng] (forma folosita peste tot in aplicatie)
      const ll = this.#map.unproject(
        L.point(p.x + nx * d * scale, p.y + ny * d * scale),
        zoom
      );
      return [ll.lat, ll.lng];
    });
  }

  _updateOffsetLines() {
    // Mutam liniile traseelor la locul corect (dupa zoom sau dupa ce
    // s-au schimbat decalajele). Traseele in animatie se aranjeaza la final.
    this.#routeLines.forEach((entry, id) => {
      if (entry.animating || !this.#workoutLayers.has(id)) return;
      const path = this._offsetPath(
        entry.route,
        this.#routeOffsets.get(id) ?? 0
      );
      entry.lines.forEach(line => line.setLatLngs(path));
    });
  }

  ////////////////////////////////////////////////
  // MODUL "FOCUS" (pentru traseele care se suprapun)

  _selectWorkout(id) {
    this.#selectedId = id;
    this._applySelection();
  }

  _applySelection() {
    const selected = this.#selectedId;

    this.#workoutLayers.forEach((group, id) => {
      // Estompam totul in afara de antrenamentul ales
      const dim = selected !== null && id !== selected;
      group.eachLayer(layer => {
        layer.getElement?.()?.classList.toggle('layer--dimmed', dim);
        layer.getPopup?.()?.getElement()?.classList.toggle('layer--dimmed', dim);
      });

      if (id === selected) {
        // Traseul ales trece deasupra celorlalte (intai conturul colorat,
        // apoi linia inchisa, ca sa ramana conturat)
        group.eachLayer(layer => {
          layer.bringToFront?.();
          layer.setZIndexOffset?.(1000);
          layer.getPopup?.()?.bringToFront();
        });
      } else {
        group.eachLayer(layer => layer.setZIndexOffset?.(0));
      }
    });

    // In lista: evidentiem antrenamentul ales
    containerWorkouts.querySelectorAll('.workout').forEach(el => {
      el.classList.toggle('workout--selected', el.dataset.id === selected);
    });

    // Butonul "Arata toate traseele" apare doar cand e ales un antrenament
    showAllBtn.classList.toggle('show-all--hidden', selected === null);
  }

  _popupContent(workout, popup) {
    // Eticheta de pe harta: la inceput arata doar tipul antrenamentului.
    // La click se deschide si arata detaliile, la inca un click se strange.
    const el = document.createElement('div');
    el.className = 'popup';
    el.title = 'Apasă pentru detalii';

    const extra =
      workout.type === 'running'
        ? `<li>⚡️ ${workout.pace.toFixed(1)} min/km</li>
           <li>🦶🏼 ${workout.cadence} pași/min</li>`
        : `<li>⚡️ ${workout.speed.toFixed(1)} km/h</li>
           <li>⛰ ${
             hasElevation(workout) ? `${workout.elevationGain} m` : '-'
           }</li>`;

    el.innerHTML = `
      <div class="popup__title">
        ${workout.type === 'running' ? '🏃‍♂️' : '🚴‍♀️'} ${typeNames[workout.type]}
      </div>
      <ul class="popup__details">
        <li>📅 ${workout.description.split(' în data de ')[1] ?? ''}</li>
        <li>📏 ${workout.distance} km</li>
        <li>⏱ ${workout.duration} min</li>
        ${extra}
      </ul>`;

    el.addEventListener('click', () => {
      el.classList.toggle('popup--open');
      el.title = el.classList.contains('popup--open')
        ? 'Apasă ca să strângi'
        : 'Apasă pentru detalii';
      // Eticheta si-a schimbat marimea, asa ca Leaflet o repozitioneaza
      popup.update();
    });
    return el;
  }

  _replayRoute(workout) {
    // Redesenam traseul animat, de la start pana la final (ca la creare).
    // Nu o facem cat timp chiar acest antrenament e in curs de modificare.
    if (!this.#map || this.#editingId === workout.id) return;
    if (!workout.route || workout.route.length < 2) return;
    this.#workoutLayers.get(workout.id)?.remove();
    this._renderWorkoutMarker(workout, true);
  }

  _handleWorkoutClick(e) {
    const workoutEl = e.target.closest('.workout');
    if (!workoutEl) return;
    const id = workoutEl.dataset.id;

    // Click pe butonul de stergere sau de modificare
    if (e.target.closest('.workout__btn--delete')) return this._deleteWorkout(id);
    if (e.target.closest('.workout__btn--edit')) return this._startEdit(id);

    // Click oriunde altundeva: mutam harta la antrenament
    // si redesenam traseul de la start pana la final
    const workout = this.#workouts.find(workout => workout.id === id);
    if (!workout) return;
    this._moveToWorkout(workout);
    // Il alegem (traseul lui deasupra, restul estompate), apoi il redesenam
    this.#selectedId = workout.id;
    this._replayRoute(workout);
    this._applySelection();
  }

  _moveToWorkout(workout) {
    // Harta inca nu s-a incarcat
    if (!this.#map) return;

    // Daca are traseu, aratam tot traseul pe ecran
    if (workout.route && workout.route.length >= 2) {
      this.#map.fitBounds(workout.route, { padding: [50, 50] });
      return;
    }

    this.#map.setView(workout.coords, this.#mapZoomLevel, {
      animation: 1,
      pan: {
        duration: 1,
      },
    });
  }

  _setLocalStorage() {
    localStorage.setItem('workouts', JSON.stringify(this.#workouts));
    // S-au schimbat antrenamentele: refacem decalajele traseelor
    if (this.#map) {
      this._computeOffsets();
      this._updateOffsetLines();
    }
    // De fiecare data cand se schimba antrenamentele, refacem sumarul lunii
    this._updateSummary();
  }

  _updateSummary() {
    // Adunam km din luna curenta, separat pentru alergare si bicicleta
    const now = new Date();
    const totals = { running: 0, cycling: 0 };
    this.#workouts.forEach(workout => {
      // Dupa reincarcarea paginii, data e text, asa ca o transformam inapoi
      const date = new Date(workout.date);
      if (
        date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear()
      )
        totals[workout.type] += +workout.distance || 0;
    });

    // Ex: "0,8 km" (cu cel mult o zecimala, in stil romanesc)
    const format = km =>
      `${km.toLocaleString('ro-RO', { maximumFractionDigits: 1 })} km`;
    document.querySelector('.summary__value--running').textContent = format(
      totals.running
    );
    document.querySelector('.summary__value--cycling').textContent = format(
      totals.cycling
    );

    // Titlul cu luna curenta, ex: "Octombrie 2026"
    const month = now.toLocaleString('ro-RO', { month: 'long' });
    document.querySelector('.summary__title').textContent = `${
      month[0].toUpperCase() + month.slice(1)
    } ${now.getFullYear()}`;
  }

  _getLocalStorage() {
    const data = JSON.parse(localStorage.getItem('workouts'));
    if (!data) return;
    // Pastram doar antrenamentele valide (fara elemente goale sau fara coordonate)
    this.#workouts = data.filter(workout => workout && workout.coords);
    // Salvam lista curatata, ca elementele stricate sa dispara definitiv
    this._setLocalStorage();
    this.#workouts.forEach(workout => this._renderWorkout(workout));
  }

  ////////////////////////////////////////////////
  // STATISTICI (meniul ☰)

  _openStats() {
    // Calculam statisticile de fiecare data cand se deschide meniul,
    // ca sa fie mereu la zi
    statsDialog.querySelector('.stats__content').innerHTML = this._statsHTML();
    statsDialog.showModal();
    // In tutorial, acesta era ultimul pas
    if (this.#tutorialStep === 5) this._endTutorial();
  }

  _statsHTML() {
    if (this.#workouts.length === 0)
      return '<p class="stats__empty">Încă nu ai niciun antrenament. Dă click pe hartă ca să adaugi primul.</p>';

    // Ex: 12,5 km
    const km = value =>
      `${value.toLocaleString('ro-RO', { maximumFractionDigits: 1 })} km`;
    // Ex: 95 min -> "1 h 35 min"
    const time = minutes => {
      const h = Math.floor(minutes / 60);
      const m = Math.round(minutes % 60);
      return h > 0 ? `${h} h ${m} min` : `${m} min`;
    };
    const decimal = value =>
      value.toLocaleString('ro-RO', { maximumFractionDigits: 1 });

    const runs = this.#workouts.filter(w => w.type === 'running');
    const rides = this.#workouts.filter(w => w.type === 'cycling');
    const sum = (list, key) => list.reduce((acc, w) => acc + (+w[key] || 0), 0);

    // ALERGARE
    const runKm = sum(runs, 'distance');
    const runMin = sum(runs, 'duration');
    const runCard = `
      <div class="stats__card stats__card--running">
        <h3 class="stats__card-title">🏃‍♂️ Alergare</h3>
        <dl class="stats__list">
          <dt>Curse</dt><dd>${runs.length}</dd>
          <dt>Distanță totală</dt><dd>${km(runKm)}</dd>
          <dt>Timp total</dt><dd>${time(runMin)}</dd>
          <dt>Ritm mediu</dt><dd>${
            runKm > 0 ? `${decimal(runMin / runKm)} min/km` : '-'
          }</dd>
          <dt>Pași/min în medie</dt><dd>${
            runMin > 0 ? Math.round((runKm * 1000) / runMin) : '-'
          }</dd>
        </dl>
      </div>`;

    // BICICLETA
    const rideKm = sum(rides, 'distance');
    const rideMin = sum(rides, 'duration');
    const withElevation = rides.filter(hasElevation);
    const rideCard = `
      <div class="stats__card stats__card--cycling">
        <h3 class="stats__card-title">🚴‍♀️ Bicicletă</h3>
        <dl class="stats__list">
          <dt>Curse</dt><dd>${rides.length}</dd>
          <dt>Distanță totală</dt><dd>${km(rideKm)}</dd>
          <dt>Timp total</dt><dd>${time(rideMin)}</dd>
          <dt>Viteză medie</dt><dd>${
            rideMin > 0 ? `${decimal(rideKm / (rideMin / 60))} km/h` : '-'
          }</dd>
          <dt>Denivelare totală</dt><dd>${
            withElevation.length
              ? `${decimal(sum(withElevation, 'elevationGain'))} m`
              : '-'
          }</dd>
        </dl>
      </div>`;

    // KM PE FIECARE LUNA (cheia e "an-luna", ex: "2026-09" pentru octombrie)
    const months = new Map();
    this.#workouts.forEach(w => {
      const date = new Date(w.date);
      const key = `${date.getFullYear()}-${String(date.getMonth()).padStart(2, '0')}`;
      if (!months.has(key))
        months.set(key, { date, running: 0, cycling: 0 });
      months.get(key)[w.type] += +w.distance || 0;
    });
    // Cea mai noua luna sus
    const rows = [...months.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([, m]) => {
        const name = m.date.toLocaleString('ro-RO', {
          month: 'long',
          year: 'numeric',
        });
        return `
        <tr>
          <td>${name[0].toUpperCase() + name.slice(1)}</td>
          <td>${km(m.running)}</td>
          <td>${km(m.cycling)}</td>
          <td><strong>${km(m.running + m.cycling)}</strong></td>
        </tr>`;
      })
      .join('');

    return `
      <h3 class="stats__section">Total</h3>
      ${runCard}
      ${rideCard}
      <h3 class="stats__section">Km în fiecare lună</h3>
      <table class="stats__table">
        <thead>
          <tr>
            <th>Luna</th>
            <th>${typeNames.running}</th>
            <th>${typeNames.cycling}</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  _confirmReset() {
    // Intai intrebam, abia apoi stergem tot
    resetDialog.showModal();
  }

  reset() {
    localStorage.removeItem('workouts');
    location.reload();
  }
}
const app = new App();
