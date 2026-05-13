import SystemConfig from '../models/SystemConfig.js';
import { auditLog } from '../utils/auditLog.js';

const ALLOWED_CATEGORIES = ['general', 'matching', 'scoring', 'parser', 'features'];
const ALLOWED_DATA_TYPES = ['string', 'number', 'boolean', 'json'];

// @route   GET /api/admin/config
// @desc    List all system configs (optionally filtered by category)
// @access  Admin
export const getAllConfigs = async (req, res) => {
  try {
    const { category } = req.query;
    const filter = category ? { category } : {};
    const configs = await SystemConfig.find(filter).sort({ category: 1, key: 1 });
    return res.json({ success: true, data: configs });
  } catch (error) {
    console.error('Get configs error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch configs' });
  }
};

// @route   POST /api/admin/config
// @desc    Create a new config entry
// @access  Admin
export const createConfig = async (req, res) => {
  try {
    const { key, value, description = '', category = 'general', dataType = 'string' } = req.body;

    if (!key || value === undefined) {
      return res.status(400).json({ success: false, message: 'key and value are required' });
    }
    if (!ALLOWED_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, message: `category must be one of: ${ALLOWED_CATEGORIES.join(', ')}` });
    }
    if (!ALLOWED_DATA_TYPES.includes(dataType)) {
      return res.status(400).json({ success: false, message: `dataType must be one of: ${ALLOWED_DATA_TYPES.join(', ')}` });
    }

    const existing = await SystemConfig.findOne({ key });
    if (existing) {
      return res.status(409).json({ success: false, message: `Config key "${key}" already exists` });
    }

    const config = await SystemConfig.create({
      key,
      value,
      description,
      category,
      dataType,
      updatedBy: req.user.userId,
    });

    await auditLog(req.user.userId, 'CREATE_CONFIG', 'SystemConfig', config._id, { key }, req);
    return res.status(201).json({ success: true, data: config });
  } catch (error) {
    console.error('Create config error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create config' });
  }
};

// @route   PUT /api/admin/config/:key
// @desc    Update an existing config value by key
// @access  Admin
export const updateConfig = async (req, res) => {
  try {
    const { value, description } = req.body;

    if (value === undefined) {
      return res.status(400).json({ success: false, message: 'value is required' });
    }

    const update = { value, updatedBy: req.user.userId };
    if (description !== undefined) update.description = description;

    const config = await SystemConfig.findOneAndUpdate(
      { key: req.params.key },
      update,
      { new: true, runValidators: true }
    );

    if (!config) {
      return res.status(404).json({ success: false, message: 'Config not found' });
    }

    await auditLog(req.user.userId, 'UPDATE_CONFIG', 'SystemConfig', config._id, { key: req.params.key, value }, req);
    return res.json({ success: true, data: config });
  } catch (error) {
    console.error('Update config error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update config' });
  }
};

// @route   DELETE /api/admin/config/:key
// @desc    Delete a config entry by key
// @access  Admin
export const deleteConfig = async (req, res) => {
  try {
    const config = await SystemConfig.findOneAndDelete({ key: req.params.key });
    if (!config) {
      return res.status(404).json({ success: false, message: 'Config not found' });
    }

    await auditLog(req.user.userId, 'DELETE_CONFIG', 'SystemConfig', config._id, { key: req.params.key }, req);
    return res.json({ success: true, message: 'Config deleted' });
  } catch (error) {
    console.error('Delete config error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete config' });
  }
};
