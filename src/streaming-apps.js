// Android package names per streaming service, so the mobile app can force-open
// the installed app instead of the browser. On iOS the web `link` already
// doubles as a Universal Link and openURL routes it to the installed app for
// free (falling back to Safari), so no iOS hint is needed. On Android a plain
// ACTION_VIEW only reaches the app when the link's host is a *verified* App
// Link — most streaming hosts aren't — so the client targets the package
// explicitly (Intent.setPackage) and falls back to web when it isn't installed.
//
// Matched by the same normalise-and-substring rules as serviceSearchLink
// (public/service-match.js): SkyShowtime is tested before Paramount/Showtime
// (brand overlap), and "Max" is HBO Max. Keyed off MotN's own service name,
// which is what the deep link carries.
import { norm } from '../public/service-match.js';

export function androidPackage(service) {
  const n = norm(service);
  if (n.includes('netflix')) return 'com.netflix.mediaclient';
  if (n.includes('disney')) return 'com.disney.disneyplus';
  if (n.includes('primevideo') || n.includes('amazon')) return 'com.amazon.avod.thirdpartyclient';
  if (n.includes('hbo') || n === 'max') return 'com.wbd.hbomax';
  if (n.includes('hulu')) return 'com.hulu.plus';
  if (n.includes('skyshowtime')) return 'com.skyshowtime.skyshowtime';
  if (n.includes('paramount') || n.includes('showtime')) return 'com.cbs.app';
  if (n.includes('appletv') || n.includes('apple')) return 'com.apple.atve.androidtv.appletv';
  if (n.includes('peacock')) return 'com.peacocktv.peacockandroid';
  return null;
}
