import { useState, useCallback } from 'react';
import { cvService } from '../services/cvService';

/**
 * useCVParsing Hook
 * Custom hook for managing CV parsing state and operations
 */
export const useCVParsing = () => {
  const [state, setState] = useState({
    currentStep: 'upload', // upload, parsing, review, success
    fileId: null,
    parsedData: null,
    editedData: null,
    isLoading: false,
    error: null,
  });

  /**
   * Upload CV and trigger parsing
   */
  const uploadAndParse = useCallback(async (file) => {
    try {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      // Upload file
      const uploadResponse = await cvService.uploadCV(file);
      const fileId = uploadResponse.file_id;

      setState((prev) => ({
        ...prev,
        fileId,
        currentStep: 'parsing',
      }));

      // Trigger parsing
      const parsedData = await cvService.parseCV(fileId);

      // Deduplicate skills
      if (parsedData.skills) {
        const uniqueSkills = Array.from(
          new Map(
            parsedData.skills.map((skill) => [skill.name.toLowerCase(), skill])
          ).values()
        );
        parsedData.skills = uniqueSkills;
      }

      setState((prev) => ({
        ...prev,
        parsedData,
        editedData: JSON.parse(JSON.stringify(parsedData)),
        currentStep: 'review',
        isLoading: false,
      }));

      return parsedData;
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error.message,
        currentStep: 'upload',
        isLoading: false,
      }));
      throw error;
    }
  }, []);

  /**
   * Edit parsed data
   */
  const editData = useCallback((editAction) => {
    setState((prev) => {
      const newData = JSON.parse(JSON.stringify(prev.editedData));

      switch (editAction.type) {
        case 'skill_add':
          if (!newData.skills) newData.skills = [];
          newData.skills.push(editAction.data);
          break;
        case 'skill_update':
          if (newData.skills) {
            const skillIndex = newData.skills.findIndex(
              (s) => s.name.toLowerCase() === editAction.oldName.toLowerCase()
            );
            if (skillIndex !== -1) {
              newData.skills[skillIndex] = editAction.data;
            }
          }
          break;
        case 'education_add':
          if (!newData.education) newData.education = [];
          newData.education.push(editAction.data);
          break;
        case 'education_update':
          if (newData.education && newData.education[editAction.index]) {
            newData.education[editAction.index] = editAction.data;
          }
          break;
        case 'experience_add':
          if (!newData.experience) newData.experience = [];
          newData.experience.push(editAction.data);
          break;
        case 'experience_update':
          if (newData.experience && newData.experience[editAction.index]) {
            newData.experience[editAction.index] = editAction.data;
          }
          break;
        default:
          break;
      }

      return { ...prev, editedData: newData };
    });
  }, []);

  /**
   * Delete from parsed data
   */
  const deleteData = useCallback((deleteAction) => {
    setState((prev) => {
      const newData = JSON.parse(JSON.stringify(prev.editedData));

      switch (deleteAction.type) {
        case 'skill':
          if (newData.skills) {
            newData.skills = newData.skills.filter(
              (s) => s.name !== deleteAction.name
            );
          }
          break;
        case 'education':
          if (newData.education) {
            newData.education = newData.education.filter(
              (_, index) => index !== deleteAction.index
            );
          }
          break;
        case 'experience':
          if (newData.experience) {
            newData.experience = newData.experience.filter(
              (_, index) => index !== deleteAction.index
            );
          }
          break;
        default:
          break;
      }

      return { ...prev, editedData: newData };
    });
  }, []);

  /**
   * Save verified data
   */
  const saveData = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      await cvService.verifyCVData(state.fileId, state.editedData);

      setState((prev) => ({
        ...prev,
        currentStep: 'success',
        isLoading: false,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error.message,
        isLoading: false,
      }));
      throw error;
    }
  }, [state.fileId, state.editedData]);

  /**
   * Reset to initial state
   */
  const reset = useCallback(() => {
    setState({
      currentStep: 'upload',
      fileId: null,
      parsedData: null,
      editedData: null,
      isLoading: false,
      error: null,
    });
  }, []);

  return {
    ...state,
    uploadAndParse,
    editData,
    deleteData,
    saveData,
    reset,
  };
};

export default useCVParsing;
