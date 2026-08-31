import { render, screen, fireEvent } from '@testing-library/react';
import Avatar from './Avatar';

describe('Avatar', () => {
  test('renders the placeholder when no src is provided', () => {
    render(<Avatar src={null} alt="Person" placeholder="J" fallbackClass="fb" />);
    expect(screen.getByText('J')).toBeInTheDocument();
  });

  test('renders the image element when a src is provided', () => {
    render(<Avatar src="https://example.com/img.jpg" alt="Person" placeholder="J" imgClass="im" />);
    const img = screen.getByAltText('Person');
    expect(img.tagName).toBe('IMG');
    expect(img).toHaveAttribute('src', 'https://example.com/img.jpg');
    expect(img).toHaveClass('im');
  });

  test('falls back to the placeholder when the image fails to load', () => {
    render(
      <Avatar
        src="broken.jpg"
        alt="Person"
        placeholder="Z"
        imgClass="im"
        fallbackClass="fb"
      />
    );
    fireEvent.error(screen.getByAltText('Person'));
    expect(screen.getByText('Z')).toBeInTheDocument();
    expect(screen.queryByAltText('Person')).toBeNull();
  });
});