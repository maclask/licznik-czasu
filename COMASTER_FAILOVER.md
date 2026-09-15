# Failover mastera w debacie — pseudokod

Opis logiki zaimplementowanej w `assets/js/online.js` dla TODO.md punkt 2
("właściwy failover"). Dotyczy wyłącznie sesji debaty (`isDebate`) — zwykłe
sesje udostępniania działają bez zmian.

## Model: generacje pokoju

Zamiast jednej stałej nazwy zapasowego huba, „żywy” pokój przesuwa się przez
rosnącą, nieograniczoną sekwencję identyfikatorów PeerJS:

```
genName(0) == debateSessionId                       // oryginalna nazwa pokoju
genName(n) == debateSessionId + '-backup' + n        // n = 1, 2, 3, ...
```

Aktualny primary comaster **zawsze proaktywnie hostuje `genName(myGeneration + 1)`**
jako stały standby. Dzięki temu:
- nikt nigdy nie musi zwalniać/odzyskiwać nazwy — awans po prostu zmienia,
  która generacja jest „aktualna”, a stara pozostaje osierocona (jej host już
  jej nie potrzebuje, ale nikt jej też siłą nie niszczy pod kimś innym),
- adres w pasku przeglądarki (i udostępniany link/QR) **zawsze** pokazuje tylko
  oryginalną nazwę pokoju — numer generacji jest czysto wewnętrznym
  szczegółem, nigdy niepokazywanym użytkownikowi.

## Model danych rosteru

```
RosterEntry {
  clientId,    // TOŻSAMOŚĆ wpisu — trwały identyfikator przeglądarki (localStorage);
               // wszystkie operacje na rosterze (findEntry, assignSlot, …) adresują po nim
  peerId,      // czysty adres transportowy PeerJS (routing wiadomości); master: null
  pushId,      // stabilny identyfikator VDO.Ninja — NIGDY nie zmieniany przy awansie
               // (promowany, wcześniej zasiadający comaster zachowuje działający
               //  strumień/&forward zamiast dostać martwe push-id)
  role,        // 'master' | null — awans to zmiana TEGO pola, żadnych przemianowań
  name, zone, index, signal, speaking, breakout,   // istniejące pola
  joinSeq,     // int, nadany raz przy dołączeniu (licznik master-only);
               // zachowywany przy ponownym dołączeniu tej samej przeglądarki (clientId)
  comaster,    // 'primary' | null — dokładnie jeden wpis naraz
  honorary,    // bool, sticky — były/zdymisjonowany master; nigdy nie wraca do kolejki
  pending,     // bool, master-only — czeka w poczekalni; niewidoczny w slimRoster()
}
```

Nie ma już sentinela `'__master__'`: rola mastera to zwykłe pole `role`, a
`peerId` nigdy nie jest przepisywany. Dzięki temu przy awansie nic nie trzeba
filtrować po specjalnym id, a `pushId` przestaje być wyjątkiem — po prostu nic
się nie zmienia.

## Kolejka sukcesji i wyznaczanie comastera

```
function computeQueue():
    return debateRoster
        .filter(e => e.role != 'master' and not e.honorary and not e.pending)
        .sortBy(e => e.joinSeq)

function syncPrimaryComaster():
    queue = computeQueue()
    current = debateRoster.find(e => e.comaster == 'primary')
    if current exists and current in queue:
        return                          // nadal ważny — nie ruszaj (sticky dla ręcznego override)
    if current exists:
        current.comaster = null
    if queue not empty:
        queue[0].comaster = 'primary'
    // UWAGA: brak osobnej wiadomości do wyznaczonego — patrz "Jak comaster
    // dowiaduje się o swojej roli" niżej.

function designateComaster(clientId):   // ręczne nadpisanie przez mastera
    target = findEntry(clientId)
    if not target or target.honorary or target.pending or target.role == 'master': return
    current = debateRoster.find(e => e.comaster == 'primary')
    if current and current.clientId != clientId:
        current.comaster = null
    target.comaster = 'primary'
    renderDebate()   // → broadcastRoster()
```

### Jak comaster dowiaduje się o swojej roli (ważna poprawka)

Pierwsza wersja wysyłała bezpośrednią wiadomość `{comasterHost: true}` do
wyznaczonego od razu przy `syncPrimaryComaster()`. To było **niewiarygodne**:
tuż po awarii/awansie mastera, świeżo wyznaczony comaster zwykle **jeszcze nie
jest podłączony** (jego własna kaskada reconnectu trwa kilka sekund) —
jednorazowa wiadomość wysłana w tym momencie po prostu go omijała.

Zamiast tego: `syncPrimaryComaster()`/`designateComaster()` tylko **mutują
pole w rosterze**. Każdy klient, odbierając **dowolny** broadcast rosteru
(`{type:'roster', ...}` — zarówno przy zwykłej zmianie, jak i natychmiast po
`conn.on('open')` przy (re)połączeniu), sam sprawdza swój wpis:

```
// w handleSlaveData, gałąź 'roster':
me = myEntry()                          // = findEntry(myClientId)
shouldHost = (me exists and me.comaster == 'primary')
if shouldHost != isPrimaryComaster:
    setComasterHosting(shouldHost)
```

To gwarantuje dostarczenie niezależnie od tego, kiedy dana osoba się połączy —
stan rosteru jest już poprawny (zmutowany synchronicznie przy promocji),
a snapshot rosteru trafia do każdego nowego/wracającego połączenia od razu przy
`conn.on('open')` w `handleMasterConnection`.

## Standby hub

```
function setComasterHosting(on):
    isPrimaryComaster = on
    if on and not backupPeer:
        backupPeer = new Peer(genName(myGeneration + 1))
        backupPeer.on('connection', handleMasterConnection)   // ta sama funkcja co dla sessionPeer
    else if not on and backupPeer:
        backupPeer.destroy()
        backupPeer = null
```

## Promocja — relabelowanie, nie tworzenie na nowo

Kluczowa różnica względem pierwszej wersji: `promoteSelfToMaster` **nie**
tworzy nowego peera ani nie próbuje niczego „odzyskać”. Skoro wywoływana jest
zawsze na kimś, kto już hostuje `backupPeer` (jedyny wiersz z przyciskiem
„Uczyń masterem” w panelu, i jedyna gałąź w `handleMasterConnLost`, która
w ogóle woła tę funkcję) — **ten sam obiekt Peer po prostu staje się hubem
mastera**:

```
function promoteSelfToMaster(source):      // source = null (awaria) albo {state, roster} (handoff)
    if isDebateMaster: return              // strażnik — ignoruj powtórne wywołanie
    if source.roster: debateRoster = source.roster
    if source.state:  applyState(source.state)

    debateRoster.removeWhere(e => e.role == 'master')   // martwy wpis eks-mastera (crash path)

    me = myEntry()                         // = findEntry(myClientId)
    me.role = 'master'                     // przejęcie = zmiana pola roli; strefa/miejsce zostają
    me.peerId = null                       // master nie ma połączenia sam do siebie
                                            // (me.pushId NIE jest ruszane — patrz wyżej)
    myGeneration += 1
    isDebateMaster = true
    isSlaveSession = false                 // inaczej App.onStateChange źle routuje zmiany
    markWasMaster(debateSessionId)         // na wypadek WŁASNEJ przyszłej awarii

    sessionPeer = backupPeer               // relabel — ten sam obiekt, zero rozłączeń
    backupPeer = null
    isPrimaryComaster = false

    syncPrimaryComaster()                  // wyznacza NOWEGO primary comastera (kolejna generacja)
    updateShareLinks()                     // odświeża link/QR/hint + history.replaceState
    renderDebate()                         // → broadcastRoster()
```

Brak tu żadnej migracji, żadnego okna karencji, żadnego niszczenia niczego —
ta cała komplikacja z pierwszej wersji (i związany z nią bug: gaszenie huba,
na którym ktoś nadal wisiał) znika strukturalnie.

## Ręczne przekazanie roli — kontrolowana awaria

```
function handoffMasterTo(peerId):
    confirm z użytkownikiem
    rosterForHandoff = debateRoster.filter(e => e.role != 'master')
    sendToPeer(peerId, {promoteToMaster, state: getFullState(), roster: rosterForHandoff})
    markWasMaster(debateSessionId)         // ja przestaję być masterem → przy powrocie honorowy comaster

    sessionPeer.destroy()                  // "niszczymy główny pokój" — dokładnie ten sam efekt co awaria:
                                            // zamyka połączenia wszystkich pozostałych, oni odkrywają
                                            // nową generację przez zwykłą kaskadę reconnectu
    isDebateMaster = false; isSlaveSession = true

    myPeer = new Peer()                    // dołączam ponownie jako zwykły uczestnik
    fromGen = myGeneration                 // pamiętam, gdzie byłem
    on myPeer open:
        connectToRoom(fromGen) -> na sukces: attachMasterConn(...); sendJoinMessage(myName)
```

Docelowy uczestnik (odbiorca `promoteToMaster`) MUSIAŁ już wcześniej być
primary comasterem (jedyny wiersz z przyciskiem „Uczyń masterem”), więc jego
`backupPeer` już żyje — wiadomość `promoteToMaster` promuje go **od razu**,
bez czekania (w przeciwieństwie do bocznych uczestników — patrz niżej), bo to
jednoznaczna, świadoma instrukcja, nie niejednoznaczne zerwanie połączenia.

## Reconnect — symetryczny na każdym poziomie

Jedna funkcja pokrywa **i** zimne dołączenie (świeży link/QR, `fromGeneration=0`),
**i** żywy reconnect (`fromGeneration` = ostatnia znana generacja):

```
function connectToRoom(fromGeneration, onSuccess, onFailure):
    tryConnect(genName(fromGeneration), 5s):
        sukces -> onSuccess(fromGeneration, conn)
        porażka -> probeForward(fromGeneration + 1, fromGeneration + 10, onSuccess, onFailure)

function probeForward(gen, maxGen, onSuccess, onFailure):
    if gen > maxGen: onFailure(); return
    tryConnect(genName(gen), 4s):
        sukces -> onSuccess(gen, conn)
        porażka -> probeForward(gen + 1, maxGen, onSuccess, onFailure)
```

`tryConnect` traktuje błąd peera `'peer-unavailable'` jako natychmiastowy
sygnał porażki (zamiast czekać na pełny timeout) — więc każda martwa generacja
odpada szybko, nie po pełnych kilku sekundach.

Dla **żywego** uczestnika, którego połączenie z masterem padło:

```
masterConn.on('close', handleMasterConnLost)

function handleMasterConnLost():
    if isDebateMaster: return              // to tylko echo naszego starego, martwego połączenia
    fromGen = myGeneration
    tryConnect(genName(fromGen), 5s):       // najpierw: może to tylko chwilowe zerwanie sieci
        sukces -> attachMasterConn(conn, fromGen, toast); return
        porażka ->
            if isPrimaryComaster: promoteSelfToMaster(null); return   // ja już hostuję kolejną generację
            probeForward(fromGen + 1, fromGen + 10, ...)               // szukam, gdzie pokój żyje teraz
```

To samo „najpierw spróbuj ponownie tej samej generacji" dotyczy **każdego**
poziomu (nie tylko `ROOM_ID → backup1`) i **też comastera** — nikt nie
promuje się/nie eskaluje natychmiast przy pierwszym zerwaniu połączenia.

## Odporność mastera na własne odświeżenie strony

Master (twórca pokoju) normalnie nie ma w pasku adresu żadnych parametrów —
gdyby odświeżył stronę, straciłby cały kontakt z pokojem (auto-join nie
uruchamia się bez `?s=`). Naprawione przez `updateShareLinks()`:

```
function updateShareLinks():
    link = origin + pathname + '?s=' + debateSessionId + '&d=1'   // ZAWSZE oryginalna nazwa, nigdy backupN
    pokaż link/QR/hint
    history.replaceState(null, '', link)   // bez przeładowania — tylko dla przyszłego odświeżenia
```

Wołane przy tworzeniu pokoju **i** po `promoteSelfToMaster` — więc każdy, kto
kiedykolwiek zostanie masterem, ma zabezpieczony powrót: po odświeżeniu
uruchamia się zwykły auto-join, `wasMaster` z localStorage daje honorowego
comastera, a `connectToRoom(0, ...)` znajdzie, gdziekolwiek pokój aktualnie
żyje.

## Honorowy comaster (powrót po awarii lub po ręcznym przekazaniu)

Nie ma trwałej tożsamości między przeładowaniami strony (PeerJS peerId jest
losowe za każdym razem) — jedyny trwały sygnał to `localStorage`:

```
markWasMaster(roomId):  localStorage[...] += roomId   (max 20 ostatnich)
checkWasMaster(roomId): roomId in localStorage[...]
```

Zarówno crash-recovery (przeładowanie strony), jak i ręczne przekazanie
(`handoffMasterTo` woła `markWasMaster` wprost, bez przeładowania) prowadzą do
tego samego: kolejne dołączenie z `wasMaster: true` → `honorary: true` →
odznaka „Co-master (h.)", nigdy nie wraca do `computeQueue()`.
