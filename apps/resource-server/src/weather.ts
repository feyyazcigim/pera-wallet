/** Real weather from Open-Meteo (no API key) so the paid response is visibly useful. */
export async function fetchIstanbulWeather(): Promise<{ temperatureC: number; windKmh: number; weatherCode: number; description: string; observedAt: string }> {
  const url = "https://api.open-meteo.com/v1/forecast?latitude=41.0082&longitude=28.9784&current=temperature_2m,wind_speed_10m,weather_code&timezone=Europe%2FIstanbul";
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const data = (await res.json()) as { current: { temperature_2m: number; wind_speed_10m: number; weather_code: number; time: string } };
  const code = data.current.weather_code;
  return {
    temperatureC: data.current.temperature_2m,
    windKmh: data.current.wind_speed_10m,
    weatherCode: code,
    description: describe(code),
    observedAt: data.current.time,
  };
}

function describe(code: number): string {
  if (code === 0) return "clear sky";
  if (code <= 3) return "partly cloudy";
  if (code <= 48) return "fog";
  if (code <= 57) return "drizzle";
  if (code <= 67) return "rain";
  if (code <= 77) return "snow";
  if (code <= 82) return "rain showers";
  if (code <= 86) return "snow showers";
  return "thunderstorm";
}
