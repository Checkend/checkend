module ApplicationHelper
  include PagyTailwind

  # Determines if the current request path matches the given URL
  # Modes:
  #   :starts_with (default) - active if current path starts with URL (good for nested routes)
  #   :path_only             - active if path matches, ignoring query string
  #   :strict                - active if path exactly equals URL
  #   Regexp                 - active if path matches the pattern
  #   Array                  - controller/action pair: [['controller'], ['action1', 'action2']]
  #   Hash                   - params matching: { controller: 'apps', id: '1' }
  #   Boolean                - explicit true/false
  def current_path_matches?(url, mode = :starts_with)
    path = request.original_fullpath
    url_path = URI.parse(url_for(url)).path

    case mode
    when :starts_with, nil
      path.match?(/^#{Regexp.escape(url_path).chomp('/')}(\/.*|\?.*)?$/)
    when :path_only
      path.match?(/^#{Regexp.escape(url_path)}\/?(\?.*)?$/)
    when :strict
      path == url
    when Regexp
      path.match?(mode)
    when Array
      controllers = Array(mode[0])
      actions = Array(mode[1])
      (controllers.empty? || controllers.include?(params[:controller])) &&
        (actions.empty? || actions.include?(params[:action]))
    when Hash
      mode.all? { |key, value| params[key].to_s == value.to_s }
    when TrueClass, FalseClass
      mode
    else
      false
    end
  end

  # Navigation link helper that automatically applies active styling
  # Uses nav_link_classes for styling based on active state
  #
  # Usage:
  #   nav_link("Dashboard", root_path)
  #   nav_link("Apps", apps_path, active: :path_only)
  #   nav_link(app_path(app), active: :starts_with) { "App Name" }
  #
  # Options:
  #   :active - Override active detection (Boolean, Symbol mode, Regexp, Array, or Hash)
  #   :icon   - Block or string for icon content
  #   All other options passed to link_to
  def nav_link(name = nil, url = nil, options = {}, &block)
    if block_given?
      options = url || {}
      url = name
      name = capture(&block)
    end

    active_option = options.delete(:active)
    active = case active_option
    when true, false
      active_option
    when Symbol, Regexp, Array, Hash
      current_path_matches?(url, active_option)
    else
      current_path_matches?(url)
    end

    css_classes = options.delete(:class)
    combined_classes = [ nav_link_classes(active: active), css_classes ].compact.join(' ')

    html_options = options.merge(class: combined_classes)
    html_options['aria-current'] = 'page' if active

    link_to(name, url, html_options)
  end

  def nav_link_classes(active:)
    base = 'group flex gap-x-3 rounded-md p-2 text-sm/6 font-semibold transition-colors'
    if active
      "#{base} bg-gray-100 dark:bg-zinc-800 text-violet-600 dark:text-violet-400"
    else
      "#{base} text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800 hover:text-violet-600 dark:hover:text-violet-400"
    end
  end

  def nav_icon_classes(active:)
    base = 'size-6 shrink-0 transition-colors'
    if active
      "#{base} text-violet-600 dark:text-violet-400"
    else
      "#{base} text-gray-400 dark:text-zinc-500 group-hover:text-violet-600 dark:group-hover:text-violet-400"
    end
  end

  def nav_badge_classes(active:)
    base = 'flex size-6 shrink-0 items-center justify-center rounded-lg border text-[0.625rem] font-medium transition-colors'
    if active
      "#{base} border-violet-600 dark:border-violet-500 bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400"
    else
      "#{base} border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-400 dark:text-zinc-500 group-hover:border-violet-600 dark:group-hover:border-violet-500 group-hover:text-violet-600 dark:group-hover:text-violet-400"
    end
  end

  def current_controller?(*names)
    names.include?(controller_name)
  end
end
