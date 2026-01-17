# frozen_string_literal: true

require 'test_helper'
require 'pagy/classes/request'
require 'pagy/toolbox/helpers/support/series'
require 'pagy/toolbox/helpers/support/a_lambda'

class PagyTailwindTest < ActionView::TestCase
  include PagyTailwind

  test 'pagy_tailwind_nav renders navigation with previous and next links' do
    pagy = create_pagy(count: 100, page: 2, limit: 10)

    html = pagy_tailwind_nav(pagy)

    assert_includes html, 'aria-label="Pagination"'
    assert_includes html, '&lsaquo; Prev'
    assert_includes html, 'Next &rsaquo;'
    assert_includes html, 'href='
    assert html.html_safe?
  end

  test 'pagy_tailwind_nav disables previous link on first page' do
    pagy = create_pagy(count: 100, page: 1, limit: 10)

    html = pagy_tailwind_nav(pagy)

    # Previous should be a span (disabled), not a link
    assert_includes html, '<span class="px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-700 text-gray-400 dark:text-zinc-600 cursor-not-allowed">&lsaquo; Prev</span>'
    # Next should be a link
    assert_includes html, 'Next &rsaquo;</a>'
  end

  test 'pagy_tailwind_nav disables next link on last page' do
    pagy = create_pagy(count: 30, page: 3, limit: 10)

    html = pagy_tailwind_nav(pagy)

    # Previous should be a link
    assert_includes html, '&lsaquo; Prev</a>'
    # Next should be a span (disabled)
    assert_includes html, '<span class="px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-700 text-gray-400 dark:text-zinc-600 cursor-not-allowed">Next &rsaquo;</span>'
  end

  test 'pagy_tailwind_nav highlights current page' do
    pagy = create_pagy(count: 100, page: 3, limit: 10)

    html = pagy_tailwind_nav(pagy)

    # Current page should be highlighted with violet background
    assert_includes html, 'bg-violet-600 text-white font-medium'
  end

  test 'pagy_tailwind_nav renders gap for many pages' do
    pagy = create_pagy(count: 500, page: 10, limit: 10)

    html = pagy_tailwind_nav(pagy)

    # Should include ellipsis for gaps
    assert_includes html, '&hellip;'
  end

  test 'pagy_tailwind_nav accepts custom id' do
    pagy = create_pagy(count: 100, page: 1, limit: 10)

    html = pagy_tailwind_nav(pagy, id: 'custom-pagination')

    assert_includes html, 'id="custom-pagination"'
  end

  test 'pagy_tailwind_nav accepts custom aria_label' do
    pagy = create_pagy(count: 100, page: 1, limit: 10)

    html = pagy_tailwind_nav(pagy, aria_label: 'Problem pages')

    assert_includes html, 'aria-label="Problem pages"'
  end

  test 'pagy_tailwind_info shows correct range and total' do
    pagy = create_pagy(count: 100, page: 2, limit: 10)

    html = pagy_tailwind_info(pagy)

    assert_includes html, 'Showing 11 to 20 of 100 results'
    assert html.html_safe?
  end

  test 'pagy_tailwind_info shows correct info for first page' do
    pagy = create_pagy(count: 50, page: 1, limit: 25)

    html = pagy_tailwind_info(pagy)

    assert_includes html, 'Showing 1 to 25 of 50 results'
  end

  test 'pagy_tailwind_info shows correct info for last partial page' do
    pagy = create_pagy(count: 33, page: 2, limit: 25)

    html = pagy_tailwind_info(pagy)

    assert_includes html, 'Showing 26 to 33 of 33 results'
  end

  private

  def create_pagy(count:, page:, limit:)
    # Build options hash similar to how Pagy::Method does it
    options = Pagy.options.merge(count:, page:, limit:)
    options[:request] = { base_url: 'http://test.host', path: '/test', params: {} }
    options[:request] = Pagy::Request.new(options)
    Pagy::Offset.new(**options)
  end
end
