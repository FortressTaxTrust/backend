import axios from 'axios';
import { jest } from '@jest/globals'; // Needed in ESM

jest.mock('axios');

export const mockZohoResponses = () => {
  axios.post.mockImplementation((url, data) => {
    return Promise.resolve({ data: { success: true } });
  });
};

