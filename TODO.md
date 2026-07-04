# Do zrobienia później

- **Odporność na awarię mastera w trakcie debaty** — obecnie cały stan (roster, czat, połączenia) żyje tylko w pamięci przeglądarki mastera; padnięcie jego komputera/sieci = wszyscy tracą sesję. Dwa warianty do wyboru:
  1. Lekki: autozapis stanu mastera do `localStorage` — chroni przed crashem karty/przeglądarki, nie chroni przed padnięciem całego komputera.
  2. Właściwy failover: wyznaczony "co-master" (uczestnik) wystawia zapasowy PeerJS hub pod przewidywalnym ID (np. `<pokój>-backup`), reszta klientów przepina się automatycznie po wykryciu rozłączenia z masterem. Do przemyślenia: promocja co-mastera, konflikt gdy oryginalny master wróci.

- Naprawa kamery i mikrofonu w Firefoksie — `getUserMedia(audio)` na ekranie dołączania wisi bez końca (nie resolve/reject) w Firefoksie, w Chrome działa. Do zbadania (rozszerzenia? ustawienia prywatności? coś specyficznego dla Firefoksa w naszym flow).

- Sprawdzić, czy poprawnie przełączamy kamery/mikrofony (podejrzenie, że nie działa jak trzeba) — dotyczy zarówno selektorów na ekranie dołączania, jak i w pokoju (`.debate-cam-select`/`.debate-mic-select`).

- Uprzątnięcie przycisków — sterowanie w debacie się rozrosło (kontrolki mastera, sygnały, media, breakout, prep time), warto przejrzeć układ/grupowanie.

- Zadbać o przypadek, gdy sędziów jest więcej niż 3 (obecny limit `ZONE_SLOTS.judges = 3`).

- Przemyśleć, jakie jeszcze przyciski/funkcje są potrzebne do prowadzenia debaty (otwarty brainstorm).

- Dodać więcej wizualnych i dźwiękowych sygnałów o tym, co się dzieje w debacie (np. wejście/wyjście z pokoju breakout, ktoś dołączył/wyszedł, zmiana miejsca).
