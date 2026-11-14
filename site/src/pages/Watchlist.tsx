import Screener from './Screener';

/** Starred symbols (localStorage), shown as the Screener in day mode restricted to the watchlist. */
export default function Watchlist() {
  return <Screener mode="watchlist" />;
}
