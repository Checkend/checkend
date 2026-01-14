# frozen_string_literal: true

# Pagy initializer file (v43+)
# See https://ddnexus.github.io/pagy/guides/upgrade-guide/

# Instance variables
Pagy.options[:limit] = 25
Pagy.options[:raise_range_error] = true  # Raise errors for out-of-range pages (enables redirect behavior)

# Custom Tailwind-styled pagination helper
module PagyTailwind
  def pagy_tailwind_nav(pagy, id: nil, aria_label: nil, **vars)
    p_prev = pagy.previous
    p_next = pagy.next

    html = +%(<nav#{id ? %( id="#{id}") : ''} class="flex items-center justify-center space-x-1" #{
      aria_label ? %(aria-label="#{aria_label}") : 'aria-label="Pagination"'
    }>)

    # Previous link
    if p_prev
      html << pagy_tailwind_link(pagy, p_prev, '&lsaquo; Prev', 'rounded-lg border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-700')
    else
      html << %(<span class="px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-700 text-gray-400 dark:text-zinc-600 cursor-not-allowed">&lsaquo; Prev</span>)
    end

    # Page links (series is protected in pagy v43, use send to access it)
    pagy.send(:series, **vars).each do |item|
      html << case item
      when Integer
                pagy_tailwind_link(pagy, item, item.to_s, 'rounded-lg border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-700')
      when String
                # Current page - item is already the page number as a string
                %(<span class="px-3 py-2 rounded-lg bg-violet-600 text-white font-medium">#{item}</span>)
      when :gap
                %(<span class="px-3 py-2 text-gray-500 dark:text-zinc-500">&hellip;</span>)
      end
    end

    # Next link
    if p_next
      html << pagy_tailwind_link(pagy, p_next, 'Next &rsaquo;', 'rounded-lg border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-700')
    else
      html << %(<span class="px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-700 text-gray-400 dark:text-zinc-600 cursor-not-allowed">Next &rsaquo;</span>)
    end

    html << %(</nav>)
    html.html_safe
  end

  def pagy_tailwind_link(pagy, page, text, classes)
    %(<a href="#{pagy.page_url(page)}" class="px-3 py-2 text-sm transition-colors #{classes}">#{text}</a>)
  end

  def pagy_tailwind_info(pagy)
    from = pagy.from
    to = pagy.to
    count = pagy.count

    %(<span class="text-sm text-gray-600 dark:text-zinc-400">Showing #{from} to #{to} of #{count} results</span>).html_safe
  end
end
