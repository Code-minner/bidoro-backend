import express from 'express';
import { Request, Response } from 'express';
import { supabase } from '../config/database';

const router = express.Router();

// Test route
router.get('/test', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Location routes working!'
  });
});

// Get all unique states
router.get('/states', async (req: Request, res: Response) => {
  try {
    const { data: locations, error } = await supabase
      .from('locations')
      .select('state')
      .eq('is_active', true)
      .order('state');

    if (error) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch states'
      });
    }

    // Get unique states
    const uniqueStates = [...new Set(locations.map(loc => loc.state))];

    res.json({
      success: true,
      data: { 
        states: uniqueStates.map(state => ({ name: state }))
      }
    });

  } catch (error) {
    console.error('States fetch error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get cities by state
router.get('/states/:stateName/cities', async (req: Request, res: Response) => {
  try {
    const { stateName } = req.params;

    const { data: locations, error } = await supabase
      .from('locations')
      .select('city')
      .eq('state', stateName)
      .eq('is_active', true)
      .order('city');

    if (error) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch cities'
      });
    }

    // Get unique cities
    const uniqueCities = [...new Set(locations.map(loc => loc.city))];

    res.json({
      success: true,
      data: { 
        cities: uniqueCities.map(city => ({ name: city }))
      }
    });

  } catch (error) {
    console.error('Cities fetch error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get areas by state and city
router.get('/states/:stateName/cities/:cityName/areas', async (req: Request, res: Response) => {
  try {
    const { stateName, cityName } = req.params;

    const { data: locations, error } = await supabase
      .from('locations')
      .select('area')
      .eq('state', stateName)
      .eq('city', cityName)
      .eq('is_active', true)
      .not('area', 'is', null)
      .order('area');

    if (error) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch areas'
      });
    }

    // Get unique areas
    const uniqueAreas = [...new Set(locations.map(loc => loc.area))];

    res.json({
      success: true,
      data: { 
        areas: uniqueAreas.map(area => ({ name: area }))
      }
    });

  } catch (error) {
    console.error('Areas fetch error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Search locations by query
router.get('/search', async (req: Request, res: Response) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    const { data: locations, error } = await supabase
      .from('locations')
      .select('*')
      .eq('is_active', true)
      .or(`state.ilike.%${q}%,city.ilike.%${q}%,area.ilike.%${q}%`)
      .order('state, city, area')
      .limit(20);

    if (error) {
      return res.status(500).json({
        success: false,
        message: 'Failed to search locations'
      });
    }

    res.json({
      success: true,
      data: { locations }
    });

  } catch (error) {
    console.error('Location search error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get all locations (for admin/management)
router.get('/all', async (req: Request, res: Response) => {
  try {
    const { data: locations, error } = await supabase
      .from('locations')
      .select('*')
      .eq('is_active', true)
      .order('state, city, area');

    if (error) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch locations'
      });
    }

    res.json({
      success: true,
      data: { locations }
    });

  } catch (error) {
    console.error('All locations fetch error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

export default router;