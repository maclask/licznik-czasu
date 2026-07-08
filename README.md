*Licznik czasu ("Time Counter") is a browser-based stopwatch built for timing speeches in Oxford-style debate tournaments. It runs a main speech timer alongside an "ad vocem" rebuttal timer and a "Joker" timer, with audio cues, a fullscreen presentation mode, and configurable sponsor/organizer logos and motion text — all as a single static HTML page with no backend or account required.*

# Licznik czasu

Licznik czasu to działający w przeglądarce stoper stworzony do odmierzania czasu mów podczas debat w stylu oksfordzkim. Obsługuje licznik główny wraz z licznikiem ad vocem oraz licznikiem Jokera, oferując sygnalizację dźwiękową, tryb pełnoekranowy oraz konfigurowalne loga sponsorów/organizatorów i tezę debaty — a wszystko to jako pojedyncza statyczna strona HTML, bez backendu i bez potrzeby zakładania konta.

Licznik dostępny jest na stronie **http://licznik.macieklaskowski.pl**.

# Funkcje

## Odmierzanie czasu

Za pomocą przycisku **Start** lub za pomocą spacji uruchomić można licznik główny, domyślnie ustawiony na 5 minut. Wartość licznika zmienić można w *ustawieniach*. Przycisk **Reset** lub wciśnięcie klawisza **1** resetuje licznik do wartości domyślnej i zatrzymuje go.

## Odmierzanie czasu ad vocem

Za pomocą przycisku **Ad vocem** lub za pomocą klawisza **2** uruchomić można licznik ad vocem, domyślnie ustawiony na 30 sekund; jego długość również zmienić można w *ustawieniach*. W trakcie odliczania ad vocem sygnał "30 sekund do końca" nie jest odtwarzany.

## Odmierzanie czasu Jokera

Licznik Jokera działa niezależnie i asynchronicznie względem licznika głównego:
- przycisk **Joker** lub klawisz **j** — rozpoczyna odliczanie,
- przycisk **Start/stop** lub klawisz **h** — pauzuje/wznawia odliczanie,
- przycisk **Zakończ** lub klawisz **k** — kończy odliczanie.

## Sygnalizacja dźwiękowa

Domyślnie na koniec czasu licznika głównego oraz na 30 sekund przed końcem odtwarzane są dźwięki sygnalizujące. Odtwarzany jest też dźwięk na zakończenie czasu Jokera. Dźwięki te można przetestować i/lub całkowicie wyłączyć w *ustawieniach*.

## Obrazy pod licznikiem

Istnieje możliwość umieszczenia dwóch obrazów pod licznikiem głównym — wybranych z gotowej listy log organizacji debatanckich lub wgranych własnym plikiem z dysku. Obrazy te można podmienić w *ustawieniach*.

## Teza

Istnieje możliwość wyświetlenia tezy nad licznikiem głównym. Tezę można ustawić w *ustawieniach*. Domyślnie pole to pozostaje puste.

## Tryb pełnoekranowy i ukrywanie sterowania

Przycisk pełnego ekranu w pasku nawigacji rozszerza widok licznika na cały ekran — przydatne przy wyświetlaniu na scenie lub rzutniku. W *ustawieniach* można też odznaczyć opcję "Pokaż menu sterujące", aby ukryć panel przycisków i zostawić na ekranie sam licznik, tezę i loga.

## Pomoc

Zakładka *Pomoc* zawiera tabelę wszystkich skrótów klawiszowych opisanych poniżej.

# Skróty klawiszowe

| Klawisz | Akcja |
| --- | --- |
| Spacja | start / pauza licznika głównego |
| 1 | reset licznika głównego |
| 2 | start licznika ad vocem |
| j | start Jokera |
| h | pauza / wznowienie Jokera |
| k | zakończenie Jokera |

#
**Wszystkie zmodyfikowane ustawienia wracają do pozycji domyślnych wraz z odświeżeniem strony**

# Technologia i wdrożenie

Aplikacja to statyczna strona (HTML, jQuery, Bootstrap) bez backendu. Wdrożenie na serwer odbywa się automatycznie przez GitHub Actions (rsync po SSH) przy każdym pushu do gałęzi `master`.
