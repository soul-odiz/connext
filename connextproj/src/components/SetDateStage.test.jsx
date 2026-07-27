import { fireEvent, render, screen } from '@testing-library/react';
import SetDateStage from './SetDateStage';

jest.mock('react-calendar', () => function MockCalendar() {
  return <div data-testid="calendar" />;
});

describe('SetDateStage', () => {
  beforeEach(() => {
    jest.spyOn(window, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    window.alert.mockRestore();
  });

  test('requires a location before confirmation', () => {
    const onDateSet = jest.fn();
    render(<SetDateStage onDateSet={onDateSet} />);

    fireEvent.click(screen.getByRole('button', { name: /confirm date/i }));

    expect(window.alert).toHaveBeenCalledWith('Please enter a location for your date.');
    expect(onDateSet).not.toHaveBeenCalled();
  });

  test('returns an ISO datetime and trimmed location', () => {
    const onDateSet = jest.fn();
    render(<SetDateStage onDateSet={onDateSet} />);

    fireEvent.change(screen.getByPlaceholderText(/central park/i), {
      target: { value: '  Cafe Central  ' },
    });
    fireEvent.change(screen.getByDisplayValue('20:00'), {
      target: { value: '19:30' },
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm date/i }));

    expect(onDateSet).toHaveBeenCalledTimes(1);
    const payload = onDateSet.mock.calls[0][0];
    expect(payload.location).toBe('Cafe Central');
    expect(new Date(payload.date_time).toString()).not.toBe('Invalid Date');
  });

  test('calls onCancel', () => {
    const onCancel = jest.fn();
    render(<SetDateStage onDateSet={jest.fn()} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});