import{describe,expect,it}from'vitest';
import{restaurantIsStale,restaurantSavedKey}from'./RestaurantCarousel';
describe('restaurant offline presentation',()=>{
  it('marks offline provider data as stale',()=>expect(restaurantIsStale('OFFLINE',true)).toBe(true));
  it('does not claim current hours when device is offline',()=>expect(restaurantIsStale('CACHE',false)).toBe(true));
  it('uses a location-scoped cache key',()=>expect(restaurantSavedKey('Catania')).toBe('pip-restaurants:catania'));
});
